import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

const REPORT_EXPIRY_SECONDS = 604800; // 7 days
const RATE_LIMIT_PER_MINUTE = 5;
const UPLOAD_DAY = 0; // Sunday
const UPLOAD_HOUR_START = 15; // 11 PM PST
const UPLOAD_HOUR_END = 16; // 12 AM PST

// TODO: Uncomment this time constraint logic when ready
function uploadWindow(): boolean {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentDay = now.getUTCDay();
    return currentDay === UPLOAD_DAY &&
        currentHour >= UPLOAD_HOUR_START &&
        currentHour < UPLOAD_HOUR_END;
}

// Check if reporter has exceeded the rate limit
async function rateLimitCheck(reporterId: string): Promise<boolean> {
    const rateLimitKey = `rate_limit:${reporterId}`;
    const currentCount = await redis.incr(rateLimitKey);
    if (currentCount === 1) {
        await redis.expire(rateLimitKey, 60);
    }
    return currentCount <= RATE_LIMIT_PER_MINUTE;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }   
    /*
    if (!uploadWindow()) {
        return res.status(403).json({ error: 'Uploads are only allowed during the specified time frame.' });
    }
    */  
    try {
        const forwardedFor = req.headers['x-forwarded-for'];
        const reporterId = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress;
        const { reports } = req.body; 
        if (!reporterId || typeof reporterId !== 'string') {
            return res.status(400).json({ error: 'Unable to identify reporter' });
        } 
        if (!Array.isArray(reports) || reports.some((hashedId) => typeof hashedId !== 'string' || !/^[a-f0-9]+$/i.test(hashedId))) {
            return res.status(400).json({ error: 'Invalid reports format. Provide a valid list of hashed IDs.' });
        } 
        if (!await rateLimitCheck(reporterId)) {
            return res.status(429).json({ error: 'Too many reports. Please try again later.' });
        } 
        const results = await Promise.all(reports.map(async (hashedId) => {
            const reportKey = `report:${hashedId}`;
            const countKey = `report:${hashedId}:count`;
            const isNewReporter = await redis.sadd(reportKey, reporterId);
            if (isNewReporter === 1) {
                await redis.incr(countKey);
            }
            await redis.expire(reportKey, REPORT_EXPIRY_SECONDS);
            await redis.expire(countKey, REPORT_EXPIRY_SECONDS);    
            const totalReports = await redis.get(countKey); 
            const reportCount = totalReports !== null ? parseInt(String(totalReports)) : 0;
            return {
                hashedId,
                message: isNewReporter === 1 
                    ? 'Report received successfully' 
                    : 'Duplicate report ignored, but expiry reset',
                reports: reportCount
            };
        }));  
        return res.status(200).json({ results });
    } catch (error) {
      console.error('Error handling reports:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
}
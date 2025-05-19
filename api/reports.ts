import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

const REPORT_EXPIRY_SECONDS = 604800; // 7 days expiry
const RATE_LIMIT_PER_MINUTE = 5;

// this function blocks uploads between 
// 23:00 and 00:00 UTC
function uploadWindow(): boolean {
    const now = new Date();
    const hour = now.getUTCHours();
    return hour !== 23;
}

// this function blocks uploads when rate limit is reached
// the rate limit is 1 minute
async function rateLimitCheck(reporterId: string): Promise<boolean> {
    const rateLimitKey = `rate_limit:${reporterId}`;
    const currentCount = await redis.incr(rateLimitKey);
    if (currentCount === 1) {
        await redis.expire(rateLimitKey, 60); 
    }
    return currentCount <= RATE_LIMIT_PER_MINUTE;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!uploadWindow()) {
        return res.status(403).json({ error: 'Uploads are only allowed during the specified upload window (Sunday from 00:00 UTC).' });
    }
    try {
        const forwardedFor = req.headers['x-forwarded-for'];
        const reporterId = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress;
        const { reports } = req.body;
        if (!reporterId || typeof reporterId !== 'string') {
            return res.status(400).json({ error: 'Unable to identify reporter.' });
        }
        if (!Array.isArray(reports) || reports.some((profileId) => typeof profileId !== 'string')) {
            return res.status(400).json({ error: 'Invalid reports format. Provide a valid list of profile IDs.' });
        }
        if (!await rateLimitCheck(reporterId)) {
            return res.status(429).json({ error: 'Too many reports. Please try again later.' });
        }
        const results = await Promise.all(
            reports.map(async (profileId) => {
                const reportKey = `report:${profileId}`;
                const countKey = `${reportKey}:count`;
                await redis.sadd(reportKey, reporterId);
                await redis.incr(countKey);
                await redis.expire(reportKey, REPORT_EXPIRY_SECONDS);
                await redis.expire(countKey, REPORT_EXPIRY_SECONDS);
                const totalReports = await redis.get(countKey);
                return {
                    profileId,
                    message: 'Report received successfully',
                    reports: totalReports ? parseInt(String(totalReports)) : 0,
                };
            })
        );
        return res.status(200).json({ results });
    } catch (error) {
        console.error('Error handling reports:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
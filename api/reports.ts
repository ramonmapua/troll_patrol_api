import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const REPORT_EXPIRY_SECONDS = 604800; // 7 days
const RATE_LIMIT_PER_MINUTE = 5;

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
    try {
        const forwardedFor = req.headers['x-forwarded-for'];
        const reporterId = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress;
        const { hashedId } = req.body;    
        if (!reporterId || typeof reporterId !== 'string') {
            return res.status(400).json({ error: 'Unable to identify reporter' });
        }
        if (!hashedId || typeof hashedId !== 'string' || !/^[a-f0-9]+$/i.test(hashedId)) {
            return res.status(400).json({ error: 'Invalid hashed ID format' });
        }
        if (!await rateLimitCheck(reporterId)) {
            return res.status(429).json({ error: 'Too many reports. Please try again later.' });
        }
        const reportKey = `report:${hashedId}`;
        const isNewReporter = await redis.sadd(reportKey, reporterId);
        if (isNewReporter === 1) {
            await redis.expire(reportKey, REPORT_EXPIRY_SECONDS);
            const totalReports = await redis.scard(reportKey);
            return res.status(200).json({ 
                message: 'Report received successfully',
                reports: totalReports
            });
        }
        const totalReports = await redis.scard(reportKey);
        return res.status(200).json({ 
            message: 'Duplicate report ignored',
            reports: totalReports
        });
    } catch (error) {
      console.error('Error handling report:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
}
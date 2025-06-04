import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

const METRICS_EXPIRY_SECONDS = 604800; // 7 days
const RATE_LIMIT_PER_MINUTE = 5;

function uploadWindow(): boolean {
    const now = new Date();
    const hour = now.getUTCHours();
    return hour !== 23;
}

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
        return res.status(403).json({ error: 'Uploads are not allowed between 23:00 and 00:00 UTC.' });
    }
    try {
        const forwardedFor = req.headers['x-forwarded-for'];
        const reporterId = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || req.socket.remoteAddress;
        if (!reporterId || typeof reporterId !== 'string') {
            return res.status(400).json({ error: 'Unable to identify reporter.' });
        }
        const { reports } = req.body;
        if (
            !reports ||
            typeof reports !== 'object' ||
            Array.isArray(reports) ||
            !['uniqueReports', 'totalReports', 'blurredEncounters', 'unblurAttempts'].every(
                key => typeof reports[key] === 'number'
            )
        ) {
            return res.status(400).json({
                error: 'Invalid format. "reports" must be an object with numeric fields: uniqueReports, totalReports, blurredEncounters, unblurAttempts.',
            });
        }
        if (!(await rateLimitCheck(reporterId))) {
            return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
        }
        const hashKey = `metrics:${reporterId}`;
        // hincrby is to increment, hset is to overwrite
        await redis.hincrby(hashKey, 'uniqueReports', reports.uniqueReports);
        await redis.hincrby(hashKey, 'totalReports', reports.totalReports);
        await redis.hincrby(hashKey, 'blurredEncounters', reports.blurredEncounters);
        await redis.hincrby(hashKey, 'unblurAttempts', reports.unblurAttempts);
        await redis.expire(hashKey, METRICS_EXPIRY_SECONDS);
        
        return res.status(200).json({ message: 'Metrics uploaded successfully.' });
    } catch (error) {
        console.error('Error handling metrics upload:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
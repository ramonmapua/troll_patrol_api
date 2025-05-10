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
const UPLOAD_DAY = 0; // sunday

function uploadWindow(): boolean {
    const now = new Date();
    const currentDay = now.getUTCDay();
    return currentDay === UPLOAD_DAY;
}

async function rateLimitCheck(reporterId: string): Promise<boolean> {
    const rateLimitKey = `rate_limit:metrics:${reporterId}`;
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
        if (!reporterId || typeof reporterId !== 'string') {
            return res.status(400).json({ error: 'Unable to identify reporter.' });
        }
        const { metrics } = req.body;
        if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || !['uniqueReports', 'totalReports', 'blurredEncounters', 'unblurAttempts'].every(key =>
            typeof metrics[key] === 'number')) {
            return res.status(400).json({
                error: 'Invalid metrics format. Must be an object with numeric fields: uniqueReports, totalReports, blurredEncounters, unblurAttempts.',
            });
        }
        if (!await rateLimitCheck(reporterId)) {
            return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
        }
        const todayISO = new Date().toISOString().split('T')[0];
        const hashKey = `metrics:${reporterId}:${todayISO}`;
        await redis.hset(hashKey, metrics);
        await redis.expire(hashKey, METRICS_EXPIRY_SECONDS);
        return res.status(200).json({ message: 'Metrics uploaded successfully.' });
    } catch (error) {
        console.error('Error handling metrics upload:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
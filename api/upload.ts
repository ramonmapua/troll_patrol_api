import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const UPLOAD_DAY = 0; // set to sunday
const UPLOAD_HOUR_START = 15; // 11 pm philippine time
const UPLOAD_HOUR_END = 16; // 12 am philippine time

// TODO: uncomment time constraint logic when ready
function uploadWindow(): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();
  return currentDay === UPLOAD_DAY &&
    currentHour >= UPLOAD_HOUR_START &&
    currentHour < UPLOAD_HOUR_END;
}

// TODO: have upload.ts only gather bloom filters from a specific time range (ie 06:00-07:00)
// this time range should also be once every x amount of days
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
    const { reportedUsers } = req.body;
    if (!reportedUsers) {
      return res.status(400).json({ error: 'Missing reportedUsers data' });
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(reportedUsers);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON format in reportedUsers' });
    }
    const { version, reportedUsers: userData } = parsedData;
    if (typeof version !== 'number' || !Array.isArray(userData)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const int32Data = new Int32Array(userData);
    const timestamp = Date.now();
    const key = `bloomFilter:${timestamp}`;
    
    await redis.set(key, JSON.stringify({ version, reportedUsers: Array.from(int32Data) }));
    console.log(`Stored bloom filter as ${key}`);
    
    return res.status(200).json({ message: 'Bloom filter uploaded successfully', key });
  } catch (error) {
    console.error('Error handling upload:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

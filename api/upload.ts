import type { VercelRequest, VercelResponse } from '@vercel/node';

const UPLOAD_DAY = 0; // set to sunday
const UPLOAD_HOUR_START = 15; // 11 pm philippine time
const UPLOAD_HOUR_END = 16; // 12 am philippine time
const BATCH_SIZE = 100; // adjust depending on expected uploads
const bloomFilterQueue: { version: number; reportedUsers: Int32Array }[] = [];
const reportTallyMap: Map<number, number> = new Map();

// TODO: uncomment time constraint logic when ready
function uploadWindow(): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();

  return currentDay === UPLOAD_DAY &&
    currentHour >= UPLOAD_HOUR_START &&
    currentHour < UPLOAD_HOUR_END;
}

// TODO: push to tally.ts when you make it
function processBatch() {
  while (bloomFilterQueue.length > 0) {
    const { reportedUsers } = bloomFilterQueue.shift()!;
    for (let i = 0; i < reportedUsers.length; i++) {
      const reportCount = reportTallyMap.get(i) || 0;
      if (reportedUsers[i] === 1) {
        reportTallyMap.set(i, reportCount + 1);
      }
    }
  }
  console.log(`Batch processed. Current tally size: ${reportTallyMap.size}`); // push here
}

// TODO: have upload.ts only gather bloom filters from a specific time range (ie 06:00-07:00)
// this time range should also be once every x amount of days
export default function handler(req: VercelRequest, res: VercelResponse) {
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
    bloomFilterQueue.push({ version, reportedUsers: int32Data });

    if (bloomFilterQueue.length >= BATCH_SIZE) {
      console.log(`Batch size reached. Processing ${bloomFilterQueue.length} filters.`);
      processBatch();
    }

    return res.status(200).json({ message: 'Bloom filter uploaded successfully', currentQueueSize: bloomFilterQueue.length });
  } catch (error) {
    console.error('Error handling upload:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
import type { VercelRequest, VercelResponse } from '@vercel/node';

let bloomFilters: { version: number; reportedUsers: Int32Array }[] = [];

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Received body:', req.body);

  try {
    if (!req.body || !req.body.reportedUsers) {
      return res.status(400).json({ error: 'Missing reportedUsers data' });
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(req.body.reportedUsers);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON format in reportedUsers' });
    }

    const { version, reportedUsers: userData } = parsedData;

    if (typeof version !== 'number' || !Array.isArray(userData)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const int32Data = new Int32Array(userData);

    bloomFilters.push({ version, reportedUsers: int32Data });

    return res.status(200).json({ message: 'Bloom filter uploaded successfully', currentUploads: bloomFilters.length });
  } catch (error) {
    console.error('Error handling upload:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

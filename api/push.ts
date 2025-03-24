import { Redis } from '@upstash/redis';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

async function getBloomFilterFromRedis(): Promise<string | null> {
    const today = new Date().toISOString().split('T')[0];
    const filePath = `bloomfilter-${today}`;
    const data = await redis.get(filePath);
    if (!data) {
        console.log('No Bloom filter found in Redis.');
        return null;
    }
    try {
        const outerData = typeof data === 'string' ? JSON.parse(data) : data;
        if (!outerData?.version || !Array.isArray(outerData.reportedUsers)) {
            throw new Error('Invalid data structure detected.');
        }
        console.log(`Bloom filter for version ${outerData.version} retrieved from Redis.`);
        return JSON.stringify(outerData, null, 2);
    } catch (error) {
        console.error('Error parsing Bloom filter data:', error);
        return null;
    }
}

async function getCurrentFileSHA(filePath: string): Promise<string | null> {
    try {
        const response = await axios.get(`https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/${filePath}`, {
            headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            },
        });
        return response.data.sha;
    } catch (error) {
        console.log('No existing file found, creating a new one.');
        return null;
    }
}

async function pushBloomFilterToGitHub() {
    const bloomFilterData = await getBloomFilterFromRedis();
    if (!bloomFilterData) return;   
    const parsedData = JSON.parse(bloomFilterData);
    const versionDate = parsedData.version;
    const filePath = `bloomfilter:${versionDate}.json`; 
    const currentSHA = await getCurrentFileSHA(filePath);
    const commitMessage = currentSHA
        ? `Update Bloom filter with reports as of ${versionDate}`
        : `Initial commit: Add Bloom filter for ${versionDate}`;  
    try {
        const response = await axios.put(
            `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/${filePath}`,
            {
                message: commitMessage,
                content: Buffer.from(bloomFilterData).toString('base64'),
                branch: process.env.GITHUB_BRANCH,
                ...(currentSHA ? { sha: currentSHA } : {}),
            },
        {
            headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            },
        }
      );    
        console.log('Bloom filter pushed to GitHub:', response.data.commit.html_url);
    } catch (error) {
        console.error('Error pushing to GitHub:', error.response?.data || error.message);
    }
}  

pushBloomFilterToGitHub();
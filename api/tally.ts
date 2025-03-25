import { Redis } from '@upstash/redis';
import BloomFilter from '../utils/BloomFilter';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
});

const REPORT_THRESHOLD = 5;
const HASH_FUNCTIONS_COUNT = 5;

function getBloomFilterKey(): string {
    const today = new Date().toISOString().split('T')[0];
    return `bloomfilter-${today}`;
}

async function loadBloomFilter(): Promise<BloomFilter> {
    const bloomFilterKey = getBloomFilterKey();
    const data = await redis.get(bloomFilterKey);
    if (data) {
        const parsedData = JSON.parse(data as string);
        return new BloomFilter(parsedData.buckets, HASH_FUNCTIONS_COUNT);
    }
    return new BloomFilter(492320, HASH_FUNCTIONS_COUNT);
}

async function saveBloomFilter(bloomFilter: BloomFilter) {
    const bloomFilterKey = getBloomFilterKey();
    const data = {
        version: new Date().toISOString().split('T')[0],
        reportedUsers: Array.from(bloomFilter.buckets),
    };
    await redis.set(bloomFilterKey, JSON.stringify(data));
    console.log('Bloom filter saved to Redis.');
}

// TODO: after this function executes, call push.ts
async function tallyReports() {
    console.log('Starting tally process...');
    const bloomFilter = await loadBloomFilter();
    const reportTallyMap: Map<string, number> = new Map();
    const keysToDelete: string[] = [];
    let cursor = '0';
    do {
        const [newCursor, keys] = await redis.scan(cursor, { match: 'report:*' });
        cursor = newCursor;
        for (const key of keys) {
            const profileId = key.split(':')[1];
            const totalReports = await redis.get(`${key}:count`);
            if (!totalReports) continue;
            reportTallyMap.set(profileId, parseInt(String(totalReports)));
            keysToDelete.push(key, `${key}:count`);
        }
    } while (cursor !== '0');
    console.log('Finished collecting report data.');
    for (const [profileId, count] of reportTallyMap.entries()) {
        if (count >= REPORT_THRESHOLD && !bloomFilter.check(profileId)) {
            bloomFilter.add(profileId);
            console.log(`Added profile ID ${profileId} to the Bloom filter with ${count} reports.`);
        }
    }
    await saveBloomFilter(bloomFilter);
    if (keysToDelete.length > 0) {
        await Promise.all(keysToDelete.map((key) => redis.del(key)));
        console.log(`${keysToDelete.length / 2} report keys cleared from Redis.`);
    } else {
        console.log('No report keys to delete.');
    }
    console.log('Tally complete.');
}

tallyReports().catch((error) => {
    console.error('Error in tally process:', error);
});

export default tallyReports;
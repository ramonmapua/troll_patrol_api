import { Redis } from '@upstash/redis';
import BloomFilter from '../utils/BloomFilter';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const REPORT_THRESHOLD = 5;
const BLOOM_FILTER_KEY = 'bloomfilter:global';
const BLOOM_FILTER_SIZE = 492320;
const HASH_FUNCTIONS_COUNT = 5;

async function loadBloomFilter(): Promise<BloomFilter> {
    const data = await redis.get(BLOOM_FILTER_KEY);
    if (data) {
        const parsedData = JSON.parse(data as string);
        return new BloomFilter(parsedData.buckets, HASH_FUNCTIONS_COUNT);
    }
    return new BloomFilter(BLOOM_FILTER_SIZE, HASH_FUNCTIONS_COUNT);
}

async function saveBloomFilter(bloomFilter: BloomFilter) {
    const data = {
        version: Date.now(),
        buckets: Array.from(bloomFilter.buckets),
    };
    await redis.set(BLOOM_FILTER_KEY, JSON.stringify(data));
    console.log('Bloom filter saved to Redis.');
}

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
            const reportData = await redis.get(key);
            if (!reportData) continue;
            const reporters = await redis.smembers(key);
            const hashedId = key.split(':')[1];
            reportTallyMap.set(hashedId, reporters.length);
            keysToDelete.push(key);
        }
    } while (cursor !== '0');
    console.log('Finished collecting report data.');
    for (const [hashedId, count] of reportTallyMap.entries()) {
        if (count >= REPORT_THRESHOLD && !bloomFilter.check(hashedId)) {
        bloomFilter.add(hashedId);
        console.log(`Added hashed ID ${hashedId} to the Bloom filter.`);
      }
    }
    await saveBloomFilter(bloomFilter);
    if (keysToDelete.length > 0) {
        await Promise.all(keysToDelete.map((key) => redis.del(key)));
        console.log(`${keysToDelete.length} report keys cleared from Redis.`);
    } else {
        console.log('No report keys to delete.');
    }   
    console.log('Tally complete.');
}

tallyReports().catch((error) => {
    console.error('Error in tally process:', error);
});
export default tallyReports;
import { Redis } from '@upstash/redis';
import BloomFilter from '../utils/BloomFilter';
import * as dotenv from 'dotenv';
dotenv.config();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const REPORT_THRESHOLD = 5;
const BLOOM_FILTER_SIZE = 492320;
const HASH_FUNCTIONS_COUNT = 5;

async function tallyReports() {
    console.log('Starting tally process...');
    const keys = await redis.keys('bloomfilter:*');
    if (keys.length === 0) {
        console.log('No Bloom filters found.');
        return;
    }
    const bloomFilters = await Promise.all(
        keys.map(async (key) => {
          const data = await redis.get(key);
          return data as { reportedUsers?: string };
        })
    );
    const reportTallyMap: Map<number, number> = new Map();
    bloomFilters.forEach((filterData) => {
        if (!filterData || !filterData.reportedUsers) {
            console.warn('Invalid or missing reportedUsers data. Skipping...');
            return;
        }
        let reportedUsers;
        try {
            reportedUsers = JSON.parse(filterData.reportedUsers);
        } catch (error) {
            console.error('Failed to parse reportedUsers:', error);
            return;
        }
        if (!Array.isArray(reportedUsers)) {
            console.warn('Invalid reportedUsers format. Skipping...');
            return;
        }
        const int32Data = new Int32Array(reportedUsers);
        int32Data.forEach((bit, index) => {
            if (bit === 1) {
                const count = reportTallyMap.get(index) || 0;
                reportTallyMap.set(index, count + 1);
            }
        });
    });
    console.log(`Aggregated reports. Total unique user reports: ${reportTallyMap.size}`);
    const bloomFilter = new BloomFilter(BLOOM_FILTER_SIZE, HASH_FUNCTIONS_COUNT);
    for (const [index, count] of Array.from(reportTallyMap.entries())) {
        if (count >= REPORT_THRESHOLD) {
            bloomFilter.add(index.toString());
        }
    }
    console.log(`Bloom filter updated. Total users added: ${bloomFilter.size()}`);
    await redis.set('bloomfilter:global', {
        version: Date.now(),
        buckets: Array.from(bloomFilter.buckets),
    });
    console.log('Global Bloom filter saved to Redis.');
    await Promise.all(keys.map((key) => redis.del(key)));
    console.log('Cleared old Bloom filters from Redis.');
}

tallyReports().catch((error) => {
    console.error('Error in tally process:', error);
});

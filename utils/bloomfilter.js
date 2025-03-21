export default class BloomFilter {

    // Creates a Bloom filter with the variables m and k.
    // m can either be an array-like object with a length
    // or m can be the number of bits of the created Bloom filter.
    // If m = array-like object, just load m into a and calculate bits.
    // If m = bits, it is rounded up to the nearest multiple of 32.
    // k = number of hashing functions
    // buckets = stores filter bits in 32 bit array
    // indexes = stores hashed results during insertion
    constructor(m, k) {
        let a;
        if (typeof m !== "number") {
            a = m; m = a.length * 32;
        }
        const n = Math.ceil(m / 32);
        this.m = n * 32;
        this.k = k;
        this.buckets = new Int32Array(n);
        if (a) {
            for (let i = 0; i < n; i++) {
                this.buckets[i] = a[i];
            }
        }
        this.indexes = new Uint32Array(new ArrayBuffer(4 * k));
    }

    // Fowler–Noll–Vo hash function
    // FNV_OFFSET_BASIS = which is the initial hash value
    // FNV_prime = prime number used in the hashing process.
    // Returns value for indexing in Bloom filter.
    fnv1aHash(value) {
        const FNV_OFFSET_BASIS = 0xCBF29CE484222325n;
        const FNV_prime = 0x100000001B3n;
        let hash = FNV_OFFSET_BASIS;
        for (let i = 0; i < value.length; i++) {
            hash ^= BigInt(value.charCodeAt(i));
            hash *= FNV_prime;
        }
        return hash;
    }

    // The function first retrieves the indexes array from the Bloom filter instance. 
    // It then computes two hash values using the fnv1aHash function.
    // k = number of hash functions (or indices)
    // r  = computed indices. Indices for setting or checking bits in the Bloom filter.
    // Calculates the Bloom filter bit locations using the hashed ID
    locations(hashedId) {
        const r = this.indexes;
        const hash1 = BigInt(`0x${hashedId}`);
        const hash2 = this.fnv1aHash(hashedId + "salt");
        for (let i = 0; i < this.k; i++) {
            r[i] = Number((hash1 + BigInt(i) * hash2) % BigInt(this.m));
        }
        return r;
    }

    // Adds a hashed ID to the Bloom filter
    add(hashedId) {
        const l = this.locations(hashedId);
        for (let i = 0; i < this.k; i++) {
            this.buckets[Math.floor(l[i] / 32)] |= 1 << (l[i] % 32);
        }
    }

    // Checks if a value is possibly in the Bloom filter.
    check(v) {
        const l = this.locations(v + "");
        for (let i = 0; i < this.k; i++) {
            const b = l[i];
            if ((this.buckets[Math.floor(b / 32)] & (1 << (b % 32))) === 0) {
                return false;
            }
        }
        return true;
    }

    // The total number of set bits obtained from countSetBits() is used in the formula 
    // to estimate how many unique elements have been added to the Bloom filter.
    // The more bits that are set, the higher the number of elements in the set.
    size() {
        let bits = 0;
        for (let i = 0; i < this.buckets.length; i++) {
            bits += this.countSetBits(this.buckets[i]);
        }
        return -this.m * Math.log(1 - bits / this.m) / this.k;
    }

    // This method is used to count the number of bits that are set to 1 in each bucket of the Bloom filter.
    // This count is crucial for estimating the number of elements in the set.
    countSetBits(n) {
        n = n - ((n >> 1) & 0x55555555);
        n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
        n = (n + (n >> 4)) & 0x0F0F0F0F;
        n = n + (n >> 8);
        n = n + (n >> 16);
        return n & 0x3F;
    }

    // Combines two arrays of buckets by performing a bitwise OR operation on corresponding elements
    // It first checks if the sizes of the two arrays match; if not, it logs an error and exits. 
    // If the sizes are the same, it updates the current buckets with the merged values and logs a success message.
    merge(newBuckets) {
        if (newBuckets.length !== this.buckets.length) {
            console.error('Bucket size mismatch. Cannot merge filters.');
            return;
        }
        for (let i = 0; i < this.buckets.length; i++) {
            this.buckets[i] |= newBuckets[i];
        }
        console.log('Merge successful.');
    }
}
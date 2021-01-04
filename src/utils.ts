import { createHash } from 'crypto';

export function sum(...nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0);
}

export type HashData = string | Buffer | NodeJS.TypedArray | DataView;

export function md5(...data: HashData[]): string {
    return data
        .reduce((hash, d) => hash.update(d),
            createHash('md5'))
        .digest('hex');
}

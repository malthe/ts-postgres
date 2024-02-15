import { BinaryLike, createHash } from 'node:crypto';

export function sum(...nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0);
}

export function md5(...data: BinaryLike[]): string {
    return data
        .reduce((hash, d) => hash.update(d), createHash('md5'))
        .digest('hex');
}

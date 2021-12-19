import { createHash, createHmac, BinaryLike } from 'crypto';

export function xorBuffers(a: Buffer, b: Buffer): Buffer {
    if (a.length !== b.length) {
        throw new Error('Buffer length mismatch');
    }
    if (a.length === 0 || b.length === 0) {
        throw new Error('Buffers cannot be empty');
    }
    return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
}

export function hmacSha256(key: BinaryLike, msg: Buffer | string) {
    return createHmac('sha256', key).update(msg).digest();
}

export function sha256(key: Buffer): Buffer {
    return createHash('sha256').update(key).digest();
}

export function hi(password: string, saltBytes: Buffer, iterations: number) {
    let ui1 = hmacSha256(password, Buffer.concat(
        [saltBytes, Buffer.from([0, 0, 0, 1])])
    );
    let ui = ui1;
    for (let i = 0; i < iterations - 1; i++) {
        ui1 = hmacSha256(password, ui1);
        ui = xorBuffers(ui, ui1);
    }
    return ui;
}

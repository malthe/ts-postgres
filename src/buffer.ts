export class ElasticBuffer {
    private offset = 0;
    private buffer: Buffer;

    constructor(size: number) {
        this.buffer = Buffer.allocUnsafe(size);
    }

    clear() {
        this.offset = 0;
    }

    get empty() {
        return this.offset === 0;
    }

    reserve(size: number) {
        let length = this.buffer.length;
        const offset = this.offset;
        const available = length - offset;

        if (available < size) {
            while (available + length < size) length *= 2;
            const buffer = Buffer.allocUnsafe(length * 2);
            this.buffer.copy(buffer, 0, 0, offset);
            this.buffer = buffer;
        }
    }

    getBuffer(size: number) {
        const offset = this.offset;
        this.reserve(size);
        this.offset += size;
        return this.buffer.slice(offset, offset + size);
    }

    consume() {
        const end = this.offset;
        const buffer = Buffer.allocUnsafe(end);
        this.buffer.copy(buffer, 0, 0, end);
        this.offset = 0;
        return buffer;
    }
}

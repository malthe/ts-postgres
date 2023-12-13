const INITIAL_SIZE = 4096;

export class ElasticBuffer {
    private offset = 0;
    private buffer?: Buffer;
    private size = INITIAL_SIZE;

    clear() {
        this.offset = 0;
    }

    get empty() {
        return this.offset === 0;
    }

    reserve(size: number) {
        let length = this.buffer?.length || 0;
        const offset = this.offset;
        const available = length - offset;

        if (available < size || !this.buffer) {
            while (available + length < size) length = Math.max(this.size, length << 1);
            const buffer = Buffer.allocUnsafe(length << 1);
            if (this.buffer) {
                this.buffer.copy(buffer, 0, 0, offset);
            }
            this.buffer = buffer;
            return buffer;
        }
        return this.buffer;
    }

    getBuffer(size: number) {
        const offset = this.offset;
        const buffer = this.reserve(size);
        this.offset += size;
        return buffer.subarray(offset, offset + size);
    }

    consume() {
        const buffer = this.buffer?.subarray(0, this.offset);
        if (buffer) {
            this.size = Math.max(this.offset, INITIAL_SIZE) >> 1;
        }
        this.offset = 0;
        this.buffer = undefined;
        return buffer;
    }

    offer(buffer: Buffer) {
        if (!this.buffer) {
            this.buffer = buffer;
        }
    }
}

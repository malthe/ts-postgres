/** A double-ended queue. All queue operations are `O(1)`. */
export class Queue<T> {
    #head = 0;
    #tail = 0;
    #capacityMask = 0b11;
    #list: (T | undefined)[] = new Array(this.#capacityMask + 1);

    /** Returns the capacity of the queue. That is, that of the inner buffer. */
    get capacity() {
        return this.#list.length;
    }

    /** Returns the current number of elements in the queue. */
    get length() {
        return this.#head <= this.#tail
            ? this.#tail - this.#head
            : this.#capacityMask + 1 - (this.#head - this.#tail);
    }

    /** Returns whether the deque is empty. */
    get empty() {
        return this.#head === this.#tail;
    }

    /** Performs a "soft" clear. This does **not** reset capacity. */
    clear() {
        this.#head = this.#tail = 0;
    }

    /** Inserts item to first slot. Returns the new length of the deque. */
    unshift(item: T) {
        const len = this.#list.length;
        this.#head = (this.#head - 1 + len) & this.#capacityMask;
        this.#list[this.#head] = item;
        if (this.#tail === this.#head) this.growArray();
        if (this.#head < this.#tail) return this.#tail - this.#head;
        return this.#capacityMask + 1 - (this.#head - this.#tail);
    }

    /** Removes and returns the first element. */
    shift(): T {
        const item = this.shiftMaybe();
        if (item !== undefined) return item;
        throw new Error("Queue is empty");
    }

    /** Removes and returns the first element or undefined.  */
    shiftMaybe(): T | undefined {
        if (this.empty) return;

        const head = this.#head;
        const item = this.#list[head];
        this.#list[head] = undefined;
        this.#head = (head + 1) & this.#capacityMask;

        if (head < 2 && this.#tail > 10000 && this.#tail <= this.#list.length >>> 2)
            this.shrinkArray();

        return item;
    }

    expect(expected?: T): T {
        const item = this.shift();
        if (item === undefined || (
            expected !== undefined && expected !== item)) {
            throw new Error(`Unexpected item: ${item} !== ${expected}`);
        }
        return item;
    }

    /** Inserts item to the last slot. Returns the new length of the deque. */
    push(item: T) {
        const tail = this.#tail;
        this.#list[tail] = item;
        this.#tail = (tail + 1) & this.#capacityMask;

        if (this.empty) this.growArray();

        if (this.#head < this.#tail) return this.#tail - this.#head;

        return this.#capacityMask + 1 - (this.#head - this.#tail);
    }

    /** Removes and returns the last element. */
    pop() {
        if (this.empty) return;

        const tail = this.#tail;
        const len = this.#list.length;
        this.#tail = (tail - 1 + len) & this.#capacityMask;

        const item = this.#list[this.#tail];
        this.#list[this.#tail] = undefined;

        if (this.#head < 2 && tail > 10000 && tail <= len >>> 2) this.shrinkArray();

        return item;
    }

    /** View the item at the specific index (without removing). */
    at(index: number) {
        // Disallow out of bounds access
        const len = this.length;
        if (index >= len || index < -len) return;

        // Wrap-around index
        if (index < 0) index += len;
        index = (this.#head + index) & this.#capacityMask;

        return this.#list[index];
    }

    *[Symbol.iterator]() {
        const head = this.#head;
        const tail = this.#tail;

        // Simply yield elements from left to right
        if (head <= tail) {
            for (let i = head; i < tail; ++i) yield this.#list[i];
            return;
        }

        // Yield elements from the head to the end
        const capacity = this.capacity;
        for (let i = head; i < capacity; ++i) yield this.#list[i];

        // Then, wrap around and yield elements from start to tail
        for (let i = 0; i < tail; ++i) yield this.#list[i];
    }

    private shrinkArray() {
        this.#list.length >>>= 1;
        this.#capacityMask >>>= 1;
    }

    private growArray() {
        // Perform rotate-left if necessary
        if (this.#head > 0) {
            // Copy existing data from head to end
            const deleted = this.#list.splice(this.#head);

            // Then, plop all preceding elements after `deleted`
            deleted.push(...this.#list);

            // Shift pointers accordingly
            this.#tail -= this.#head;
            this.#head = 0;

            // Discard old array
            this.#list = deleted;
        }

        // Head is at 0 and array is now full,
        // therefore safe to extend
        this.#tail = this.#list.length;

        // Double the capacity
        this.#list.length *= 2;
        this.#capacityMask = (this.#capacityMask << 1) | 1;
    }
}

/** A double-ended queue. All queue operations are `O(1)`. */
export class Queue<T> {
    #head = 0;
    #tail = 0;
    #capacityMask = 0b11;
    #list: (T | undefined)[] = new Array(this.#capacityMask + 1);

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

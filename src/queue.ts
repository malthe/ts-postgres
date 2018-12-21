export class Queue<T extends any = undefined> {
    private container: Array<T | undefined> = [];

    private head = 0;
    private tail = 0;
    private length = 0;
    private size = 0;

    constructor(private initialCapacity: number = 32) {
    }

    push(item: T) {
        if (this.length === this.size) this.double();

        this.container[this.tail] = item;
        this.length++;
        this.tail++;

        if (this.tail === this.size) this.tail = 0;
    }

    shift(expected?: T): T {
        const item = this.container[this.head];
        this.container[this.head] = undefined;

        if (typeof item === 'undefined' || (
            typeof expected !== 'undefined' && expected !== item)) {
            throw new Error(`Unexpected item: ${item} !== ${expected}`);
        }

        this.head++;
        this.length--;

        if (this.head === this.size) this.head = 0;

        if (this.length === this.size / 4 &&
            this.length > this.initialCapacity) {
            this.shrink();
        }

        return item!;
    };

    isEmpty() {
        return this.length === 0;
    };

    private double() {
        let source = this.head;
        let target = 0;
        let newContainer = [];
        newContainer.length = 2 * this.size;

        while (target < this.size) {
            newContainer[target] = this.container[source];
            source++;
            target++;
            if (source === this.size) source = 0;
        }
        this.container = newContainer;
        this.head = 0;
        this.tail = this.size;
        this.size *= 2;
    }

    private shrink() {
        let source = this.head;
        let target = 0;
        let newContainer = [];
        newContainer.length = this.size / 4;

        while (target < this.size) {
            newContainer[target] = this.container[source];
            source++;
            target++;
            if (source === this.size) source = 0;
        }
        this.container = newContainer;
        this.head = 0;
        this.tail = this.size;
        this.size /= 4;
    }

}

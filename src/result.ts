import { zip } from './utils';

type ResolveType<T> = (resolve: (value: T) => void) => void;

type Callback<T> = (item: T) => void;

export class Result<T> extends Promise<T[][]> implements AsyncIterable<T[]> {
    private subscribers: ((done: boolean) => void)[] = [];
    private done = false;

    public rows: T[][] | null = null;
    public names: string[] | null = null;

    constructor(private container: T[][], executor: ResolveType<T[][]>) {
        super((resolve, reject) => {
            executor((value: T[][]) => {
                resolve(value)
            });
        });
    };

    notify(done: boolean) {
        if (done) this.done = true;
        for (let subscriber of this.subscribers) subscriber(done);
    };

    asMapArray() {
        if (this.done) {
            return Promise.resolve(this.toMapArray());
        };

        return this.then((rows) => {
            return this.toMapArray(rows);
        });
    }

    private toMapArray(rows = this.rows || []) {
        const names = this.names || [];
        return rows.map((values: T[]) => {
            return zip(names, values);
        });
    }

    [Symbol.asyncIterator](): AsyncIterator<T[]> {
        let i = 0;

        const container = this.container;

        const shift = () => {
            let item = container[i];
            i++;
            return item;
        };

        return {
            next: async (): Promise<IteratorResult<T[]>> => {
                if (container.length <= i) {
                    if (this.done) {
                        return { done: true, value: undefined! };
                    }

                    if (await new Promise<boolean>(
                        (resolve, reject) => {
                            this.subscribers.push(resolve);
                        })) {
                        return { done: true, value: undefined! };
                    }
                }

                return { value: shift(), done: false };
            }
        };
    };
}

export type DataHandler<T> = Callback<T | null>;

export type NameHandler = Callback<string[]>;

Result.prototype.constructor = Promise

export function makeResult<T>(
    registerDataHandler: (handler: DataHandler<T[] | null>) => void,
    registerNameHandler: (handler: NameHandler) => void):
    Result<T> {
    let finish: ((value: T[][]) => void) | null = null;

    const rows: T[][] = [];

    let p = new Result<T>(rows, (resolve) => {
        finish = resolve;
    });

    const onData = (row: T[] | null) => {
        if (row === null) {
            if (finish) {
                p.rows = rows;
                finish(rows);
            }
            p.notify(true);
        } else {
            rows.push(row);
            p.notify(false);
        };
    };

    const onNames = (names: string[]) => {
        p.names = names;
    }

    registerDataHandler(onData);
    registerNameHandler(onNames);

    return p;
};

import { zip } from './utils';

type ResultHandler<T> = (resolve: () => void) => void;
type Callback<T> = (item: T) => void;

export class Result<T> {
    constructor(public names: string[], public rows: T[][]) { }

    [Symbol.iterator](): Iterator<Map<string, T>> {
        let i = 0;

        const rows = this.rows;
        const length = rows.length;

        const shift = () => {
            const names = this.names;
            const values = rows[i];
            i++;
            return zip(names, values);
        };

        return {
            next: () => {
                if (i === length) return { done: true, value: undefined! };
                return { done: false, value: shift() };
            }
        }
    }
}

export class ResultIterator<T> extends Promise<Result<T>>
    implements AsyncIterable<Map<string, T>> {
    private subscribers: ((done: boolean) => void)[] = [];
    private done = false;

    public rows: T[][] | null = null;
    public names: string[] | null = null;

    constructor(private container: T[][], executor: ResultHandler<T>) {
        super((resolve, reject) => {
            executor(() => {
                const names = this.names || [];
                const rows = this.rows || [];
                resolve(new Result(names, rows));
            });
        });
    };

    notify(done: boolean) {
        if (done) this.done = true;
        for (let subscriber of this.subscribers) subscriber(done);
    };

    [Symbol.asyncIterator](): AsyncIterator<Map<string, T>> {
        let i = 0;

        const container = this.container;

        const shift = () => {
            const names = this.names;
            const values = container[i];
            i++;

            if (names === null) {
                throw new Error("Column name mapping missing.");
            }

            return zip(names, values);
        };

        return {
            next: async () => {
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

ResultIterator.prototype.constructor = Promise

export function makeResult<T>(
    registerDataHandler: (handler: DataHandler<T[] | null>) => void,
    registerNameHandler: (handler: NameHandler) => void):
    ResultIterator<T> {
    let finish: (() => void) | null = null;

    const rows: T[][] = [];

    let p = new ResultIterator<T>(rows, (resolve) => {
        finish = resolve;
    });

    const onData = (row: T[] | null) => {
        if (row === null) {
            if (finish) {
                p.rows = rows;
                finish();
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

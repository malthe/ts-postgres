type Resolver = (error: null | string) => void;
type ResultHandler = (resolve: Resolver) => void;
type Callback<T> = (item: T) => void;

export class ResultRow<T> {
    private readonly length: number;

    constructor(public readonly names: string[], public readonly data: T[]) {
        this.length = names.length;
    }

    get(name: string): T {
        for (let i = 0; this.length; i++) {
            if (this.names[i] === name) {
                return this.data[i];
            }
        }
        throw new Error(`Key not found: ${name}`);
    }
}

export class Result<T> {
    constructor(public names: string[], public rows: T[][]) { }

    [Symbol.iterator](): Iterator<ResultRow<T>> {
        let i = 0;

        const rows = this.rows;
        const length = rows.length;

        const shift = () => {
            const names = this.names;
            const values = rows[i];
            i++;
            return new ResultRow<T>(names, values);
        };

        return {
            next: () => {
                if (i === length) return { done: true, value: undefined! };
                return { done: false, value: shift() };
            }
        }
    }
}

export class ResultIterator<T> extends Promise<Result<T>> {
    private subscribers: ((done: boolean, error?: string) => void)[] = [];
    private done = false;

    public rows: T[][] | null = null;
    public names: string[] | null = null;

    constructor(private container: T[][], executor: ResultHandler) {
        super((resolve, reject) => {
            executor((error) => {
                if (error) {
                    reject(new Error(error));
                } else {
                    const names = this.names || [];
                    const rows = this.rows || [];
                    resolve(new Result(names, rows));
                }
            });
        });
    };

    async first() {
        for await (const row of this) {
            return row;
        }
    }

    one() {
        return new Promise<ResultRow<T>>(
            (resolve, reject) => {
                this.first().then((value?: ResultRow<T>) => {
                    if (value) {
                        resolve(value);
                    } else {
                        reject(new Error('Query returned an empty result'));
                    }
                }).catch(() => null);
                this.catch(reject);
            });
    }

    notify(done: boolean, error?: string) {
        if (done) this.done = true;
        for (let subscriber of this.subscribers) subscriber(done, error);
        this.subscribers.length = 0;
    };

    [Symbol.asyncIterator](): AsyncIterator<ResultRow<T>> {
        let i = 0;

        const container = this.container;

        const shift = () => {
            const names = this.names;
            const values = container[i];
            i++;

            if (names === null) {
                throw new Error("Column name mapping missing.");
            }

            return new ResultRow<T>(names, values);
        };

        return {
            next: async () => {
                if (container.length <= i) {
                    if (this.done) {
                        return { done: true, value: undefined! };
                    }

                    if (await new Promise<boolean>(
                        (resolve, reject) => {
                            this.subscribers.push(
                                (done: boolean, error?: string) => {
                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve(done)
                                    }
                                });
                        })) {
                        return { done: true, value: undefined! };
                    }
                }

                return { value: shift(), done: false };
            }
        };
    };
}

export type DataHandler<T> = Callback<T | null | string>;

export type NameHandler = Callback<string[]>;

ResultIterator.prototype.constructor = Promise

export function makeResult<T>() {
    let dataHandler: DataHandler<T[] | null> | null = null;
    const nameHandler = (names: string[]) => {
        p.names = names;
    }
    const rows: T[][] = [];
    const p = new ResultIterator<T>(rows, (resolve) => {
        dataHandler = ((row: T[] | null | string) => {
            if (row === null) {
                p.rows = rows;
                resolve(null);
                p.notify(true);
            } else if (typeof row === 'string') {
                resolve(row);
                p.notify(true, row);
            } else {
                rows.push(row);
                p.notify(false);
            }
        });
    });

    return {
        iterator: p,
        dataHandler: dataHandler!,
        nameHandler: nameHandler
    };
};

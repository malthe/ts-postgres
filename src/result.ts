/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { DatabaseError } from './protocol';

type Resolution = null | string | Error | DatabaseError;
type Resolver = (resolution: Resolution) => void;
type ResultHandler = (resolve: Resolver) => void;
type Callback<T> = (item: T) => void;

export class ResultRow<T> {
    private readonly length: number;

    constructor(public readonly names: string[], public readonly data: T[]) {
        this.length = names.length;
    }

    get(name: string): T | undefined {
        for (let i = 0; i < this.length; i++) {
            if (this.names[i] === name) {
                return this.data[i];
            }
        }
    }
}

export class Result<T> {
    constructor(
        public names: string[],
        public rows: T[][],
        public status: null | string
    ) { }

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
    private subscribers: (
        (done: boolean, error?: (string | DatabaseError | Error)
        ) => void)[] = [];
    private done = false;

    public rows: T[][] | null = null;
    public names: string[] | null = null;

    constructor(private container: T[][], executor: ResultHandler) {
        super((resolve, reject) => {
            executor((resolution) => {
                if (resolution instanceof Error) {
                    reject(resolution);
                } else {
                    const names = this.names || [];
                    const rows = this.rows || [];
                    resolve(new Result(names, rows, resolution));
                }
            });
        });
    }

    async first() {
        for await (const row of this) {
            return row;
        }
    }

    async one() {
        for await (const row of this) {
            return row;
        }
        throw new Error('Query returned an empty result');
    }

    notify(done: boolean, status?: (string | DatabaseError | Error)) {
        if (done) this.done = true;
        for (const subscriber of this.subscribers) subscriber(done, status);
        this.subscribers.length = 0;
    }

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

        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        let error: any = null;

        this.catch((reason) => {
            error = new Error(reason);
        });

        return {
            next: async () => {
                if (error) {
                    throw error;
                }

                if (container.length <= i) {
                    if (this.done) {
                        return { done: true, value: undefined! };
                    }

                    if (await new Promise<boolean>(
                        (resolve, reject) => {
                            this.subscribers.push(
                                (done, status) => {
                                    if (typeof status !== 'undefined') {
                                        reject(status);
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
    }
}

export type DataHandler<T> = Callback<T | Resolution>;

export type NameHandler = Callback<string[]>;

ResultIterator.prototype.constructor = Promise

export function makeResult<T>() {
    let dataHandler: DataHandler<T[] | null> | null = null;
    const nameHandler = (names: string[]) => {
        p.names = names;
    }
    const rows: T[][] = [];
    const p = new ResultIterator<T>(rows, (resolve) => {
        dataHandler = ((row: T[] | Resolution) => {
            if (row === null || typeof row === 'string') {
                p.rows = rows;
                resolve(row);
                p.notify(true);
            } else if (Array.isArray(row)) {
                rows.push(row);
                p.notify(false);
            } else {
                resolve(row);
                p.notify(true, row);
            }
        });
    });

    return {
        iterator: p,
        dataHandler: dataHandler!,
        nameHandler: nameHandler
    };
}

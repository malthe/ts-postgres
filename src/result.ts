/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { DatabaseError } from './protocol';

type Resolution = null | string;
type Callback<T> = (item: T) => void;
type ResultHandler = (resolve: Callback<Resolution>, reject: Callback<Error | DatabaseError>) => void;

/** The default result type, used if no generic type parameter is specified. */
export type ResultRecord<T = any> = Record<string, T>;


function makeRecord<T>(names: string[], data: ReadonlyArray<any>): T {
    const result: Record<string, any> = {};
    names.forEach((key, j) => result[key] = data[j]);
    return result as T;
}

class ResultRowImpl<T> extends Array<any> {
    #names?: string[];
    #lookup?: Map<keyof T, number>;

    set(names: string[], lookup: Map<keyof T, number>, values: any[]) {
        this.#names = names;
        this.#lookup = lookup;
        this.push(...values);
    }

    /**
     * Return value for the provided column name.
     */
    get<K extends string & keyof T>(name: keyof T): T[K] {
        const i = this.#lookup?.get(name);
        if (i === undefined) throw new Error(`Invalid column name: ${String(name)}`);
        return this[i];
    }

    /**
     * Return an object mapping column names to values.
     */
    reify() {
        if (this.#names === undefined) throw new Error('Column names not available'); 
        return makeRecord<T>(this.#names, this);
    }
}

/**
 * A result row provides access to data for a single row, extending an array.
 * @interface
 *
 * The generic type parameter is carried over from the query method.
 *
 * To retrieve a column value by name use the {@link get} method; or use {@link reify} to convert
 * the row into an object.
 *
 */
export type ResultRow<T> = ReadonlyArray<T> & Pick<ResultRowImpl<T>, 'get' | 'reify'>;

/**
 * The awaited query result.
 *
 * Iterating over the result yields objects of the generic type parameter.
 */
export class Result<T = ResultRecord> {
    constructor(
        public names: string[],
        public rows: ResultRow<T>[],
        public status: null | string
    ) { }

    [Symbol.iterator](): Iterator<T> {
        let i = 0;

        const rows = this.rows;
        const length = rows.length;
        const names = this.names;

        const shift = () => {
            const data = rows[i++];
            return makeRecord<T>(names, data);
        };

        return {
            next: () => {
                if (i === length) return { done: true, value: undefined! };
                return { done: false, value: shift() };
            }
        }
    }
}

/**
 * The query result iterator.
 *
 * Iterating asynchronously yields objects of the generic type parameter.
 */
export class ResultIterator<T = ResultRecord> extends Promise<Result<T>> {
    private subscribers: (
        (done: boolean, error?: (string | DatabaseError | Error)
        ) => void)[] = [];
    private done = false;

    constructor(private names: string[], private data: any[][], executor: ResultHandler) {
        super((resolve, reject) => {
            executor((status) => {
                const names = this.names || [];
                const data = this.data || [];

                const lookup: Map<keyof T, number> = new Map();
                let i = 0;
                for (const name of names) {
                    lookup.set(name as keyof T, i);
                    i++;
                }

                resolve(new Result(names, data.map(values => {
                    const row = new ResultRowImpl<T>();
                    row.set(names, lookup, values);
                    return row;
                }), status));
            }, reject);
        });
    }

    /**
     * Return the first item (if any) from the query results.
     */
    async first() {
        for await (const row of this) {
            return row;
        }
    }

    /**
     * Return the first item from the query results, or throw an error.
     */
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

    [Symbol.asyncIterator](): AsyncIterator<T> {
        let i = 0;

        //const container = this.container;

        const shift = () => {
            const names = this.names;
            const values = this.data[i];
            i++;

            if (names === null) {
                throw new Error("Column name mapping missing.");
            }

            return makeRecord<T>(names, values);
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

                if (this.data.length <= i) {
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

export type DataHandler = Callback<any[] | Resolution | Error>;

export type NameHandler = Callback<string[]>;

ResultIterator.prototype.constructor = Promise

export function makeResult<T>(transform?: (name: string) => string) {
    let dataHandler: DataHandler | null = null;

    const names: string[] = [];
    const rows: any[][] = [];

    const p = new ResultIterator<T>(names, rows, (resolve, reject) => {
        dataHandler = ((row: any[] | Resolution | Error) => {
            if (row === null || typeof row === 'string') {
                resolve(row);
                p.notify(true);
            } else if (Array.isArray(row)) {
                rows.push(row);
                p.notify(false);
            } else {
                reject(row);
                p.notify(true, row);
            }
        });
    });

    const nameHandler = (ns: string[]) => {
        names.length = 0;
        if (transform) {
            ns = ns.map(transform);
        }
        names.push(...ns);
    }

    return {
        iterator: p,
        dataHandler: dataHandler!,
        nameHandler: nameHandler
    };
}

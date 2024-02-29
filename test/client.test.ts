import { Buffer } from 'node:buffer';
import { createServer, AddressInfo, Socket } from 'node:net';
import { env, hrtime } from 'node:process';
import { describe } from 'node:test';
import { equal, deepEqual, rejects, strictEqual } from 'node:assert';

import { test } from './helper.js';
import {
    Client,
    DataFormat,
    DataType,
    Notification,
    PreparedStatement,
    Result,
    ResultIterator,
    ResultRecord,
    SSLMode,
} from '../src/index.js';
import { postgresqlErrorCodes } from '../src/errors.js';

// Adjust for benchmarking mode.
const benchmarkEnabled = env.NODE_ENV === 'benchmark';
const timedQueryTime = benchmarkEnabled ? 5000 : 500;

const enum TestQuery {
    PgType,
    Array,
}

interface Query {
    text: string;
    values?: any[];
}

function makeRandomizer(seed: number) {
    return (n: number): number => {
        const x = Math.sin(seed++) * 10000;
        const r = x - Math.floor(x);
        return Math.floor(r * Math.floor(n));
    };
}

function secondsFromHrTime(time: [number, number]) {
    const d = hrtime(time);
    return d[0] + d[1] / 10 ** 9;
}

function unsafeToSimpleQuery(query: Query) {
    let text = query.text;
    const params = (query.values || []).map(String);
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        text = text.replace('$' + (i + 1), param);
    }
    return { text };
}

function testSelect(
    testQuery: TestQuery,
    batchSize: number,
    doReplaceArgs: boolean,
) {
    /* eslint-disable-next-line prefer-const */
    let { name, query } = (() => {
        switch (testQuery) {
            case TestQuery.Array:
                return {
                    name: 'Array',
                    query: {
                        // tslint:disable-next-line
                        text: 'select (select array_agg(i) from generate_series(1, 100) as s(i)) from generate_series(1, 100)',
                    },
                };
            case TestQuery.PgType:
                return {
                    name: 'PgType',
                    query: {
                        // tslint:disable-next-line
                        text: 'select typname, typnamespace, typowner, typlen, typbyval, typcategory, typispreferred, typisdefined, typdelim, typrelid, typelem, typarray from pg_type where typtypmod = $1 and typisdefined = $2',
                        values: [-1, true],
                    },
                };
        }
    })();

    if (doReplaceArgs) {
        query = unsafeToSimpleQuery(query);
    }

    test(`SQL: Select (${testQuery}; ${doReplaceArgs}; batch size: ${batchSize})`, async ({
        client,
    }) => {
        const go = async (
            time: number,
        ): Promise<[number, number, number, number]> => {
            let queries = 0;
            let acknowledged = 0;
            let results = 0;
            const startTime = hrtime();
            const secs = time / 1000;

            while (true) {
                const d = secs - secondsFromHrTime(startTime);
                if (d < 0) {
                    break;
                }

                let i = batchSize;
                const promises: Promise<void>[] = [];

                while (i--) {
                    const p = client
                        .query(query.text, query.values)
                        .then((result: Result) => {
                            acknowledged += 1;
                            results += result.rows.length;
                        });

                    queries++;
                    promises.push(p);
                }

                await Promise.all(promises);
            }

            const d = secondsFromHrTime(startTime);
            return [queries, results, queries - acknowledged, d];
        };

        await go(timedQueryTime / 10);

        const [queries, rows, diff, time] = await go(timedQueryTime);
        const round = (n: number) => {
            return Math.round(n / time);
        };

        if (benchmarkEnabled) {
            const secs = (Math.round(time * 100) / 100).toFixed(2) + ' secs';
            const q = round(queries);
            const r = round(rows);
            console.log(
                `[${name}] Q/sec: ${q}; ` +
                    `R/sec: ${r} (${secs}); ` +
                    `B: ${batchSize}`,
            );
        }

        equal(diff, 0);
    });
}

describe('Connection', () => {
    test('Info', async ({ client }) => {
        equal(
            client.encrypted,
            !!(client.config.ssl && client.config.ssl !== SSLMode.Disable),
        );
    });
    test('Timeout', async ({ connect }) => {
        const server = createServer();
        await new Promise((resolve) => {
            server.listen(0, 'localhost', 1, () => {
                resolve(undefined);
            });
        });
        const sockets = new Set<Socket>();
        server.on('connection', (socket) => {
            sockets.add(socket);
            server.once('close', () => {
                sockets.delete(socket);
            });
        });
        strictEqual(server.listening, true);
        const address = server.address() as AddressInfo;
        await rejects(
            connect({
                host: address.address,
                port: address.port,
                connectionTimeout: 250,
            }),
            /Timeout after 250 ms/,
        );
        for (const socket of sockets.values()) {
            socket.destroy();
        }
        return new Promise((resolve) => {
            server.close(() => {
                resolve(undefined);
            });
        });
    }, 500);
});

describe('Query', () => {
    test('Without parameters', async ({ client }) => {
        const result = await client.query('select 1');
        equal(result.rows.length, 1);
    });

    test('With parameters', async ({ client }) => {
        const result = await client.query('select $1::int', [1]);
        equal(result.rows.length, 1);
    });

    test('Named portal', async ({ client }) => {
        const result = await client.query('select $1::int', [1]);
        equal(result.rows.length, 1);
    });

    test('Custom value type reader', async ({ client }) => {
        client.config.types = new Map([
            [
                DataType.Int4,
                (
                    buffer: Buffer,
                    start: number,
                    end: number,
                    format: DataFormat,
                    encoding?: string,
                ) => {
                    const value = buffer.readInt32BE(start);
                    equal(end - start, 4);
                    equal(value, 1);
                    equal(format, DataFormat.Binary);
                    equal(encoding, 'utf-8');
                    return 1;
                },
            ],
        ]);
        const result = await client.query('select 1::int4');
        equal(result.rows.length, 1);
    });

    test('Name transform', async ({ client }) => {
        const query = {
            text: 'select 1 as foo',
            transform: (s: string) => s.toUpperCase(),
        };
        const result = await client.query(query);
        deepEqual(result.names, ['FOO']);
    });

    test('Listen/notify', async ({ client, connect }) => {
        const notifies: Omit<Notification, 'processId'>[] = [];
        const listener = ({ channel, payload }: Notification) => {
            notifies.push({ channel, payload });
        };
        client.on('notification', listener);
        const p = client.query('listen foo');
        const other = await connect();
        await other.query("notify foo, 'bar'");
        await other.end();
        deepEqual(notifies, [{ channel: 'foo', payload: 'bar' }]);
        await p;
        await client.query("notify foo, 'baz'");
        client.off('notification', listener);
        await client.query("notify foo, 'boo'");
        deepEqual(notifies, [{ channel: 'foo', payload: 'bar' }, { channel: 'foo', payload: 'baz' }]);
    });

    test('Session timeout', async ({ connect }) => {
        const client = await connect({
            idleSessionTimeout: 500,
            idleInTransactionSessionTimeout: 500,
        });
        const errors: (keyof typeof postgresqlErrorCodes)[] = [];
        client.on('error', (error) => errors.push(error.code));
        await new Promise((resolve) => setTimeout(resolve, 625));
        equal(client.closed, true);
        deepEqual(errors, ['57P05']);
    });

    test('Cursor', async ({ client }) => {
        await client.query('begin');
        await client.query('declare foo cursor for select $1::int4', [1]);
        const result = await client.query('fetch next from foo');
        deepEqual(result.names, ['int4']);
        deepEqual(result.rows, [[1]]);
    });

    test('Stream', async ({ client }) => {
        const s = 'abcdefghijklmnopqrstuvxyz'.repeat(Math.pow(2, 17));
        const buffer = Buffer.from(s);
        const server = createServer((conn) => {
            let offset = 0;
            conn.on('data', (data: Buffer) => {
                const s = data.toString();
                buffer.write(s, offset);
                offset += s.length;
            });
        });

        await new Promise((resolve) => {
            server.listen(
                {
                    port: 0,
                    host: 'localhost',
                    backlog: 1,
                },
                () => {
                    resolve(undefined);
                },
            );
        });

        strictEqual(server.listening, true);
        const address = server.address() as AddressInfo;
        const socket = new Socket();
        socket.connect(address.port);
        await client.query(
            {
                text: 'select upper($1)::bytea as col',
                streams: { col: socket },
            },
            [Buffer.from(s)],
        );

        // At this point we're done really done streaming, and how can
        // we know when that happens?
        //
        // Probably, the query should return only when the callback
        // comes through.
        return new Promise((resolve) => {
            socket.on('close', () => {
                server.close(() => {
                    try {
                        equal(buffer.toString(), s.toUpperCase());
                    } finally {
                        resolve(undefined);
                    }
                });
            });
            socket.end();
        });
    });

    test('Return table', async ({ client }) => {
        await client.query(`
            create function pg_temp.foo() returns table(bar int)
            language sql begin atomic
            select 123;
            end
        `);
        const result = await client
            .query<{ bar: number }>('select * from pg_temp.foo()')
            .first();
        equal(result?.bar, 123);
    });

    test('Query errors become promise rejection', async ({ client }) => {
        await rejects(client.query('select foo'), /foo/);
    });

    interface QueryTest {
        query: ResultIterator<ResultRecord>;
        expectation:
            | {
                  names: string[];
                  rows: any[];
                  status: string;
              }
            | RegExp;
    }

    interface PrepareTest {
        query: Promise<PreparedStatement>;
        expectation: RegExp;
    }

    const tests: Array<
        (client: Client, seed: number) => QueryTest | PrepareTest
    > = [
        (client: Client) => {
            return {
                query: client.query('select foo'),
                expectation: /foo/,
            };
        },
        (client: Client) => {
            return {
                query: client.query('select boo, $1 as bar', [0]),
                expectation: /boo/,
            };
        },
        (client: Client) => {
            return {
                query: client.query('select 1 as i'),
                expectation: { names: ['i'], rows: [[1]], status: 'SELECT 1' },
            };
        },
        (client: Client) => {
            return {
                query: client.query('select 1 / $1 as j', [0]),
                expectation: /division by zero/,
            };
        },
        (client: Client) => {
            return {
                query: client.query('select $1::int as k', [2]),
                expectation: { names: ['k'], rows: [[2]], status: 'SELECT 1' },
            };
        },
        (client: Client) => {
            return {
                query: client.query('select $1::internal as l', ['']),
                expectation: /2281/,
            };
        },
        (client: Client, seed: number) => {
            const random = makeRandomizer(seed);
            const alphabet = 'abcdefghijklmnopqrstuvwxyz';
            const columns = random(alphabet.length) || 1;
            const blocksize = random(71) || 1;
            const names: string[] = [];
            const row: string[] = [];
            let query = 'select ';
            for (let i = 0; i < columns; i++) {
                const column = String.fromCharCode('a'.charCodeAt(0) + i);
                const string = alphabet.substring(0, i + 1).repeat(blocksize);
                names.push(column);
                row.push(string);
                if (i > 0) query += ', ';
                query += `'${string}' as ${column}`;
            }
            return {
                query: client.query(query),
                expectation: { names: names, rows: [row], status: 'SELECT 1' },
            };
        },
        (client: Client) => {
            return {
                query: client.prepare('select $1::int as i from badtable'),
                expectation: /badtable/,
            };
        },
    ];

    function make(client: Client, n: number, seed: number): Promise<void> {
        const p = tests[n](client, seed);
        if (p.expectation instanceof RegExp) {
            return rejects(p.query, p.expectation);
        } else {
            return p.query.then((actual: any) =>
                deepEqual(actual, p.expectation),
            );
        }
    }

    function makeTest(ns: number[]) {
        test(`Pipeline combination query ${ns.join(';')}`, async ({
            client,
        }) => {
            const promises: Promise<void>[] = [];
            for (let i = 0; i < ns.length; i++) {
                const p = make(client, ns[i], 1);
                promises.push(p);
            }
            await Promise.all(promises);
        });
    }

    for (let i = 0; i < tests.length; i++) {
        makeTest([i]);
        for (let j = 0; j < tests.length; j++) {
            makeTest([i, j]);
        }
    }

    test('Pipeline combination query (fuzzy)', async ({ client }) => {
        const random = makeRandomizer(1);

        for (let i = 0; i < 5; i++) {
            let remaining = 500;
            while (remaining) {
                const count =
                    Math.min(
                        Math.max(random(remaining), 1),
                        (remaining / 2) >> 0,
                    ) || 1;
                remaining -= count;
                const promises: Promise<void>[] = [];
                for (let j = 0; j < count; j++) {
                    const n = random(tests.length);
                    const p = make(client, n, remaining);
                    promises.push(p);
                }
                await Promise.all(promises);
            }
        }
    });

    test('Empty query', async ({ client }) => {
        const result = await client.query('');
        deepEqual(result, { names: [], rows: [], status: null });
    });

    test('Unsupported type', async ({ client }) => {
        const text = 'select $1::internal';
        await rejects(client.query(text, ['']), /2281/);
    });

    test('Prepare and execute (SELECT)', async ({ client }) => {
        const stmt = await client.prepare('select $1::int as i');
        const result1 = await stmt.execute([1]);
        deepEqual(result1, { names: ['i'], rows: [[1]], status: 'SELECT 1' });
        const result2 = await stmt.execute([2]);
        deepEqual(result2.rows, [[2]]);
        await stmt.close();
    });

    test('Prepare and execute (SELECT, transform)', async ({ client }) => {
        const query = {
            text: 'select $1::int as i',
            transform: (s: string) => s.toUpperCase(),
        };
        const stmt = await client.prepare(query);
        const result1 = await stmt.execute([1]);
        deepEqual(result1, { names: ['I'], rows: [[1]], status: 'SELECT 1' });
        const result2 = await stmt.execute([2]);
        deepEqual(result2.rows, [[2]]);
        await stmt.close();
    });

    test('Prepare and execute (INSERT)', async ({ client }) => {
        await client.query('create temporary table foo (bar int)');
        const stmt = await client.prepare('insert into foo values ($1)');
        const result1 = await stmt.execute([1]);
        deepEqual(result1, { names: [], rows: [], status: 'INSERT 0 1' });
        const result2 = await stmt.execute([2]);
        deepEqual(result2.rows, []);
    });

    test('Prepare and execute error', async ({ client }) => {
        const stmt = client.prepare('select $1::int as i from badtable');
        await rejects(stmt, /badtable/);
    });

    testSelect(TestQuery.PgType, 1, false);
    testSelect(TestQuery.PgType, 5, false);
    testSelect(TestQuery.PgType, 1, true);
    testSelect(TestQuery.PgType, 5, true);
    testSelect(TestQuery.Array, 1, false);
    testSelect(TestQuery.Array, 5, false);
    testSelect(TestQuery.Array, 1, true);
    testSelect(TestQuery.Array, 5, true);
});

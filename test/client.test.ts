import { createServer, AddressInfo, Socket } from 'net';
import { testWithClient } from './helper';
import { Query } from '../src/query';
import { Client, Result, ResultIterator } from '../src/client';
import { DataFormat, DataType } from '../src/types';

// Adjust for benchmarking mode.
const benchmarkEnabled = process.env.NODE_ENV === 'benchmark';
const [maxTime, WarmupTime] = (benchmarkEnabled) ?
    [5000, 1000] : [500, 100];

const enum TestQuery {
    PgType,
    Array
}

function secondsFromHrTime(time: [number, number]) {
    const d = process.hrtime(time);
    return d[0] + d[1] / (10 ** 9);
}

function unsafeToSimpleQuery(query: Query) {
    let text = query.text;
    const params = (query.values || []).map(String);
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        text = text.replace('$' + (i + 1), param);
    }
    return new Query(text);
}

function testSelect(
    testQuery: TestQuery,
    batchSize: number,
    doReplaceArgs: boolean) {
    /* eslint-disable-next-line prefer-const */
    let { name, query } = (() => {
        switch (testQuery) {
            case TestQuery.Array: return {
                name: 'Array',
                query: new Query(
                    // tslint:disable-next-line
                    'select (select array_agg(i) from generate_series(1, 100) as s(i)) from generate_series(1, 100)'
                )
            };
            case TestQuery.PgType: return {
                name: 'PgType',
                query: new Query(
                    // tslint:disable-next-line
                    'select typname, typnamespace, typowner, typlen, typbyval, typcategory, typispreferred, typisdefined, typdelim, typrelid, typelem, typarray from pg_type where typtypmod = $1 and typisdefined = $2',
                    [-1, true]
                )
            };
        }
    })();

    if (doReplaceArgs) {
        query = unsafeToSimpleQuery(query);
    }

    testWithClient(`SQL: Select (${testQuery}; ${doReplaceArgs}; batch size: ${batchSize})`,
        async (client) => {
            expect.assertions(1);

            const go = async (time: number):
                Promise<[number, number, number, number]> => {
                let queries = 0;
                let acknowledged = 0;
                let results = 0;
                const startTime = process.hrtime();
                const secs = time / 1000;

                while (true) {
                    const d = secs - secondsFromHrTime(startTime);
                    if (d < 0) {
                        break;
                    }

                    let i = batchSize;
                    const promises: Promise<void>[] = [];

                    while (i--) {
                        const p = client.query(query).then(
                            (result: Result) => {
                                acknowledged += 1;
                                results += result.rows.length;
                            });

                        queries++;
                        promises.push(p)
                    }

                    await Promise.all(promises);
                }

                const d = secondsFromHrTime(startTime);
                return [queries, results, queries - acknowledged, d];
            }

            if (WarmupTime) await go(WarmupTime);

            const [queries, rows, diff, time] = await go(maxTime);
            const round = (n: number) => { return Math.round(n / time) };

            if (benchmarkEnabled) {
                const secs =
                    (Math.round(time * 100) / 100).toFixed(2) + ' secs';
                const q = round(queries);
                const r = round(rows);
                console.log(
                    `[${name}] Q/sec: ${q}; ` +
                    `R/sec: ${r} (${secs}); ` +
                    `B: ${batchSize}`
                );
            }

            expect(diff).toEqual(0);
        }, (WarmupTime + maxTime) + 10000);
}

describe('Events', () => {
    testWithClient('End', async (client) => {
        expect.assertions(1);
        const f = jest.fn();
        client.on('end', f);
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        const p = new Promise((resolve, _) => {
            client.on('connect', async () => {
                await client.end();
                resolve(undefined);
            });
        });
        await p;
        expect(f).toBeCalled();
    });

    testWithClient('Connect', async (client) => {
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        const p = new Promise((resolve, _) => {
            client.on('connect', () => {
                setTimeout(() => {
                    expect(true).toBeTruthy();
                    resolve(undefined);
                }, 125);
            });
        });
        expect.assertions(1);
        return p;
    });
});

describe('Timeout', () => {
    test('Connection timeout', async () => {
        const server = createServer();
        await new Promise((resolve) => {
            server.listen(0, "localhost", 1, () => { resolve(undefined) });
        });
        const sockets = new Set<Socket>();
        server.on('connection', (socket) => {
            sockets.add(socket); server.once('close', () => {
                sockets.delete(socket);
            });
        });
        expect(server.listening).toBeTruthy();
        const address = server.address() as AddressInfo;
        const client = new Client({
            connectionTimeout: 250,
            host: process.env["PGHOST"] || address.address,
            port: address.port,
        });

        await expect(client.connect()).rejects.toThrow(/Timeout after 250 ms/);
        await client.end();
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
    testWithClient('Without parameters', async (client) => {
        expect.assertions(1);
        const query = new Query('select 1');
        const result = await client.query(query);
        expect(result.rows.length).toEqual(1);
    });

    testWithClient('With parameters', async (client) => {
        expect.assertions(1);
        const query = new Query('select $1::int', [1]);
        const result = await client.query(query);
        expect(result.rows.length).toEqual(1);
    });

    testWithClient('Named portal', async (client) => {
        expect.assertions(1);
        const query = new Query('select $1::int', [1]);
        const result = await client.query(query);
        expect(result.rows.length).toEqual(1);
    });

    testWithClient('Custom value type reader', async (client) => {
        expect.assertions(5);
        client.config.types = new Map([
            [DataType.Int4, (
                buffer: Buffer,
                start: number,
                end: number,
                format: DataFormat,
                encoding?: string) => {
                const value = buffer.readInt32BE(start);
                expect(end - start).toEqual(4);
                expect(value).toEqual(1);
                expect(format).toEqual(DataFormat.Binary);
                expect(encoding).toEqual('utf-8');
                return 1;
            }]
        ]);
        const result = await client.query('select 1::int4');
        expect(result.rows.length).toEqual(1);
    });

    testWithClient('Prepared statement', async (client) => {
        const count = 5;
        expect.assertions(count * 2);
        await client.query('prepare test (int) as select $1');
        for (let i = 0; i < count; i++) {
            const result = await client.query('execute test(1)');
            const rows = result.rows;
            expect(rows.length).toEqual(1);
            expect(rows[0]).toEqual([1]);
        }
    });

    testWithClient('Listen/notify', async (client) => {
        await client.query('listen foo');
        expect.assertions(2);
        client.on('notification', (msg) => {
            expect(msg.channel).toEqual('foo');
            expect(msg.payload).toEqual('bar');
        });
        await client.query('notify foo, \'bar\'');
    })

    testWithClient('Cursor', async (client) => {
        await client.query('begin');
        await client.query('declare foo cursor for select $1::int4', [1]);
        const result = await client.query('fetch next from foo');
        expect(result.names).toEqual(['int4']);
        expect(result.rows).toEqual([[1]]);
    })

    testWithClient(
        'Query errors become promise rejection',
        async (client) => {
            await expect(client.query('select foo')).rejects.toThrow(/foo/);
        }
    );

    interface Test {
        query: ResultIterator;
        expectation: {
            names: string[];
            rows: number[][];
            status: string;
        } | RegExp;
    }

    const tests: Array<(client: Client) => Test> = [
        (client: Client) => {
            return {
                query: client.query('select foo'),
                expectation: /foo/
            }
        },
        (client: Client) => {
            return {
                query: client.query('select boo, $1 as bar', [0]),
                expectation: /boo/
            }
        },
        (client: Client) => {
            return {
                query: client.query('select 1 as i'),
                expectation: { names: ['i'], rows: [[1]], status: 'SELECT 1' }
            }
        },
        (client: Client) => {
            return {
                query: client.query('select 1 / $1 as j', [0]),
                expectation: /division by zero/
            }
        },
        (client: Client) => {
            return {
                query: client.query('select $1::int as k', [2]),
                expectation: { names: ['k'], rows: [[2]], status: 'SELECT 1' }
            }
        },
        (client: Client) => {
            return {
                query: client.query('select $1::internal as l', [""]),
                expectation: /2281/
            }
        }
    ];

    function make(client: Client, n: number) {
        const p = tests[n](client);
        const e = expect(p.query);
        if (p.expectation instanceof RegExp) {
            return e.rejects.toThrow(p.expectation)
        } else {
            return e.resolves.toEqual(p.expectation)
        }
    }

    function makeTest(ns: number[]) {
        testWithClient(
            `Pipeline combination query ${ns.join(';')}`,
            async (client) => {
                const promises = [];
                for (let i = 0; i < ns.length; i++) {
                    const p = make(client, ns[i]);
                    promises.push(p);
                }
                await Promise.all(promises);
            }
        );
    }

    for (let i = 0; i < tests.length; i++) {
        makeTest([i]);
        for (let j = 0; j < tests.length; j++) {
            makeTest([i, j]);
        }
    }

    testWithClient(
        'Pipeline combination query (fuzzy)',
        async (client) => {
            let seed = 1;
            function random(n: number) {
                const x = Math.sin(seed++) * 10000;
                const r = x - Math.floor(x);
                return Math.floor(r * Math.floor(n));
            }

            for (let i = 0; i < 5; i++) {
                let remaining = 500;
                while (remaining) {
                    const count = Math.min(
                        Math.max(random(remaining), 1),
                        remaining / 2 >> 0
                    ) || 1;
                    remaining -= count;
                    const promises: Promise<void>[] = [];
                    for (let j = 0; j < count; j++) {
                        const n = random(tests.length);
                        const p = make(client, n);
                        promises.push(p);
                    }
                    await Promise.all(promises);
                }
            }
        },
        5000
    );

    testWithClient('Empty query', async (client) => {
        await expect(client.query('')).resolves.toEqual(
            { names: [], rows: [], status: null }
        );
    });

    testWithClient('Unsupported type', async (client) => {
        const text = 'select $1::internal';
        await expect(client.query(text, [''])).rejects.toThrow(/2281/);
    });

    testWithClient(
        'Prepare and execute',
        async (client) => {
            const stmt = await client.prepare('select $1::int as i');
            await expect(stmt.execute([1])).resolves.toEqual(
                { names: ['i'], rows: [[1]], status: 'SELECT 1' }
            );
            const result = await stmt.execute([2]);
            expect(result.rows).toEqual([[2]]);
            await stmt.close();
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

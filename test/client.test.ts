import { withClient } from './helper';
import { Client } from '../src/client';
import { Query } from '../src/query';
import { Result } from '../src/result';
import { DataFormat, DataType, Builtin } from '../src/types';

// Adjust for benchmarking mode.
const benchmarkEnabled = process.env.NODE_ENV === 'benchmark';
const [maxTime, WarmupTime] = (benchmarkEnabled) ?
    [5000, 1000] : [50, 10];

const enum TestQuery {
    PgType,
    Array
};

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
    };
    return new Query(text);
}

function testSelect(
    client: Client,
    testQuery: TestQuery,
    batchSize: number,
    doReplaceArgs: boolean) {
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
        };
    })();

    if (doReplaceArgs) {
        query = unsafeToSimpleQuery(query);
    };

    test(`SQL: Select (batch size: ${batchSize})`, async () => {
        expect.assertions(1);

        const go = async (time: number):
            Promise<[number, number, number, number]> => {
            let queries = 0;
            let acknowledged = 0;
            let results = 0;
            let startTime = process.hrtime();
            let secs = time / 1000;

            while (true) {
                const d = secs - secondsFromHrTime(startTime);
                if (d < 0) {
                    break;
                }

                let i = batchSize;
                let promises: Promise<void>[] = [];

                while (i--) {
                    const p = client.query(query).then(
                        (result: Result<any>) => {
                            acknowledged += 1;
                            results += result.rows.length;
                        });

                    queries++;
                    promises.push(p)
                }

                await Promise.all(promises);
            };

            let d = secondsFromHrTime(startTime);
            return [queries, results, queries - acknowledged, d];
        };

        if (WarmupTime) await go(WarmupTime);

        let [queries, rows, diff, time] = await go(maxTime);
        let round = (n: number) => { return Math.round(n / time) };

        if (benchmarkEnabled) {
            const secs = (Math.round(time * 100) / 100).toFixed(2) + ' secs';
            const q = round(queries);
            const r = round(rows);
            console.log(
                `[${name}] Q/sec: ${q}; R/sec: ${r} (${secs}); B: ${batchSize}`
            );
        }

        expect(diff).toEqual(0);
        return true;
    }, (WarmupTime + maxTime) + 10000);
};

describe('Events', withClient([
    (client) => {
        test('End', async () => {
            expect.assertions(1);
            const f = jest.fn();
            client.on('end', f);
            await client.end();
            expect(f).toBeCalled();
        });
    },
    (client) => {
        let p = new Promise((resolve, reject) => {
            client.on('connect', () => {
                setTimeout(() => {
                    expect(true).toBeTruthy();
                    resolve();
                }, 125);
            });
        });
        test('Connect', () => {
            expect.assertions(1);
            return p;
        });
    },
]));

describe('Query', withClient([
    (client) => {
        test('Without parameters', async () => {
            expect.assertions(1);
            const query = new Query('select 1');
            const result = await client.query(query);
            expect(result.rows.length).toEqual(1);
        });
    },
    (client) => {
        test('With parameters', async () => {
            expect.assertions(1);
            const query = new Query('select $1::int', [1]);
            const result = await client.query(query);
            expect(result.rows.length).toEqual(1);
        });
    },
    (client) => {
        test('Custom value type reader', async () => {
            expect.assertions(3);
            client.config.types = new Map([
                [DataType.Int4, (
                    buffer: Buffer,
                    start: number,
                    end: number,
                    format: DataFormat,
                    encoding?: string) => {
                    const value = buffer.readInt32BE(start);
                    expect(value).toEqual(1);
                    expect(format).toEqual(DataFormat.Binary);
                    return 1;
                }]
            ]);
            const result = await client.query('select 1::int4');
            expect(result.rows.length).toEqual(1);
        });
    },
    (client) => {
        test('Prepared statement', async () => {
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
    },
    (client) => {
        test('Listen/notify', async () => {
            await client.query('listen foo');
            expect.assertions(2);
            client.on('notification', (msg) => {
                expect(msg.channel).toEqual('foo');
                expect(msg.payload).toEqual('bar');
            });
            await client.query('notify foo, \'bar\'');
        })
    },
    (client) => {
        test('Cursor', async () => {
            await client.query('begin');
            await client.query('declare foo cursor for select $1::int4', [1]);
            const result = await client.query('fetch next from foo');
            expect(result.names).toEqual(['int4']);
            expect(result.rows).toEqual([[1]]);
        })
    },
    (client) => {
        test('Query errors become promise rejection', async () => {
            await expect(client.query('select foo')).rejects.toThrow(/foo/);
        });
    },
    (client) => {
        test('Query errors plays nicely with pipeline', async () => {
            let p1 = client.query('select foo');
            let p2 = client.query('select 1 as i');
            await expect(p1).rejects.toThrow(/foo/);
            await expect(p2).resolves.toEqual(
                { "names": ['i'], "rows": [[1]] }
            );
        });
    },
    (client) => {
        test('Empty query', async () => {
            await expect(client.query('')).resolves.toEqual(
                { names: [], rows: [] }
            );
        });
    },
    (client) => { testSelect(client, TestQuery.PgType, 1, false) },
    (client) => { testSelect(client, TestQuery.PgType, 5, false) },
    (client) => { testSelect(client, TestQuery.PgType, 1, true) },
    (client) => { testSelect(client, TestQuery.PgType, 5, true) },
    (client) => { testSelect(client, TestQuery.Array, 1, false) },
    (client) => { testSelect(client, TestQuery.Array, 5, false) },
    (client) => { testSelect(client, TestQuery.Array, 1, true) },
    (client) => { testSelect(client, TestQuery.Array, 5, true) },
]));

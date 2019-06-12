import { md5 } from '../src/utils';
import { testWithClient } from './helper';
import { Query } from '../src/query';
import { Result } from '../src/client';
import { DataFormat, DataType } from '../src/types';

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

    testWithClient(`SQL: Select (batch size: ${batchSize})`,
        async (client) => {
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
                            (result: Result) => {
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
};

describe('Events', () => {
    testWithClient('End', async (client) => {
        expect.assertions(1);
        const f = jest.fn();
        client.on('end', f);
        await client.end();
        expect(f).toBeCalled();
    });

    testWithClient('Connect', async (client) => {
        let p = new Promise((resolve, _) => {
            client.on('connect', () => {
                setTimeout(() => {
                    expect(true).toBeTruthy();
                    resolve();
                }, 125);
            });
        });
        expect.assertions(1);
        return p;
    });
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

    testWithClient(
        'Query errors plays nicely with pipeline',
        async (client) => {
            const random = (n: number) =>
                Math.floor(Math.random() * Math.floor(n));

            const make = (n: number): Promise<void> | undefined => {
                switch (n) {
                    case 0: {
                        const p = client.query('select foo');
                        return expect(p).rejects.toThrow(/foo/);
                    };
                    case 1: {
                        const p = client.query('select 1 as i');
                        return expect(p).resolves.toEqual(
                            { "names": ['i'], "rows": [[1]] }
                        );
                    }
                    case 2: {
                        const p = client.query('select 1 / $1 as j', [0]);
                        return expect(p).rejects.toThrow(/division by zero/);
                    }
                    case 3: {
                        const p = client.query('select $1::int as k', [2]);
                        return expect(p).resolves.toEqual(
                            { "names": ['k'], "rows": [[2]] }
                        );
                    }
                    case 4: {
                        const p = client.query(
                            'select $1::internal as l',
                            [""]
                        );
                        return expect(p).rejects.toThrow(/2281/);
                    }
                };
            };

            const go = async (remaining: number): Promise<void> => {
                if (remaining === 0) return Promise.resolve();
                const i = Math.min(
                    Math.max(random(remaining), 1),
                    remaining / 2
                );
                const promises: Promise<void>[] = [];
                for (let j = 0; j < i; j++) {
                    const n = random(5);
                    const p = make(n);
                    if (p) promises.push(p);
                }
                return Promise.all(promises).then(
                    () => {
                        return go(remaining - promises.length)
                    }
                );
            }

            for (let i = 0; i < 10; i++) {
                await go(500);
            }
        },
        5000
    );

    testWithClient('Empty query', async (client) => {
        await expect(client.query('')).resolves.toEqual(
            { names: [], rows: [] }
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
                { "names": ['i'], "rows": [[1]] }
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

test("",()=>{
  const salt = new Uint8Array(4);
  salt[0] = 46;
  salt[1] = 226;
  salt[2] = 27;
  salt[3] = 67;
  const shadow = md5('passwordflynotes');
  const transfer = md5(
    shadow,
    salt);
  console.log(shadow);
  console.log(transfer);
  console.log(md5(transfer));
});
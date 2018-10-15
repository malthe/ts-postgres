import { withClient } from './helper';
import { Client } from '../src/client';
import { Query } from '../src/query';
import { Result } from '../src/result';
import { DataType, Builtin } from '../src/types';

const pgTypeQuery = new Query(
    // tslint:disable-next-line
    'select typname, typnamespace, typowner, typlen, typbyval, typcategory, typispreferred, typisdefined, typdelim, typrelid, typelem, typarray from pg_type where typtypmod = $1 and typisdefined = $2',
    [-1, true]
);

const arrayQuery = new Query(
    // tslint:disable-next-line
    'select (select array_agg(i) from generate_series(1, 100) as s(i)) from generate_series(1, 100)'
);

// Adjust for benchmarking mode.
const benchmarkEnabled = process.env.NODE_ENV === 'benchmark';
const [maxTime, WarmupTime] = (benchmarkEnabled) ?
    [5000, 1000] : [50, 10];

function secondsFromHrTime(time: [number, number]) {
    const d = process.hrtime(time);
    return d[0] + d[1] / (10 ** 9);
}

function testSelect(
    client: Client,
    query: Query,
    batchSize: number,
    doReplaceArgs: boolean) {
    let mode: string;

    if (doReplaceArgs) {
        query = query.unsafeToSimpleQuery();
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
            console.log(`Q/sec: ${q}; R/sec: ${r} (${secs}); B: ${batchSize}`);
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
            const query = pgTypeQuery.unsafeToSimpleQuery();
            const result = await client.query(query);
            expect(result.rows.length).toBeGreaterThan(100);
        });
    },
    (client) => {
        test('With parameters', async () => {
            expect.assertions(1);
            const result = await client.query(pgTypeQuery);
            expect(result.rows.length).toBeGreaterThan(100);
        });
    },
    (client) => {
        test('Custom value type reader', async () => {
            expect.assertions(2);
            client.config.types = new Map([
                [DataType.Int4, (
                    buffer: Buffer,
                    start: number,
                    end: number,
                    encoding?: string) => {
                    const value = buffer.readInt32BE(start);
                    expect(value).toEqual(1);
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
    (client) => { testSelect(client, pgTypeQuery, 1, false) },
    (client) => { testSelect(client, pgTypeQuery, 5, false) },
    (client) => { testSelect(client, pgTypeQuery, 1, true) },
    (client) => { testSelect(client, pgTypeQuery, 5, true) },
]));

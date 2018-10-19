import { withClient } from './helper';
import { Client } from '../src/client';
import { DataType, Row, Value } from '../src/types';
import { Result, ResultIterator } from '../src/result';

type ResultFunction =
    (result: ResultIterator<Value>) =>
        Promise<Map<string, Value>[]>;

async function testIteratorResult(client: Client, f: ResultFunction) {
    const result = client.query(
        'select generate_series($1::int, $2::int) as i', [0, 9]
    );
    const maps = await f(result);

    expect(maps.length).toEqual(10);
    let expectation = [...Array(10).keys()];
    const keys = maps.map((map) => [...map.keys()]);
    const values = maps.map((map) => [...map.values()]);

    // Keys are column names.
    expect(keys).toEqual(expectation.map(() => ['i']));

    // Values are row values.
    expect(values).toEqual(expectation.map((i) => [i]));

    // We could iterate once again over the same set of data.
    let count = 0;
    for await (const row of result) {
        count += 1;
    };
    expect(count).toEqual(10);

    // Or use the spread operator.
    const rows = [...await result];
    expect(rows.length).toEqual(10);
    expect(rows[0].get('i')).toEqual(0);

    // The result is also available in the public rows attribute.
    expect(result.rows).toEqual(
        expectation.map((i) => { return [i] })
    );

}

describe('Result', withClient([
    (client) => {
        test('Names', async () => {
            expect.assertions(2);
            let result = await client.query(
                'select $1::text as message', ['Hello world!']
            );
            expect(result.names.length).toEqual(1);
            expect(result.names[0]).toEqual('message');
        });
    },
    (client) => {
        test('Synchronous iteration', async () => {
            expect.assertions(7);
            await testIteratorResult(
                client,
                (p) => {
                    return p.then((result) => {
                        const maps: Map<string, Value>[] = [];
                        for (const map of result) {
                            maps.push(map);
                        };
                        return maps;
                    });
                });
        });
    },
    (client) => {
        test('Asynchronous iteration', async () => {
            expect.assertions(7);
            await testIteratorResult(
                client,
                async (result) => {
                    const maps: Map<string, Value>[] = [];
                    for await (const map of result) {
                        maps.push(map);
                    };
                    return maps;
                });
        });
    }
]));

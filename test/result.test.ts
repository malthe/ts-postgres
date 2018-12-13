import { testWithClient } from './helper';
import { Client } from '../src/client';
import { Value } from '../src/types';
import { ResultIterator, ResultRow } from '../src/result';

type ResultFunction =
    (result: ResultIterator<Value>) =>
        Promise<ResultRow<Value>[]>;

async function testIteratorResult(client: Client, f: ResultFunction) {
    const query = () => client.query(
        'select generate_series($1::int, $2::int) as i', [0, 9]
    );
    const rows = await f(query());

    expect(rows.length).toEqual(10);
    let expectation = [...Array(10).keys()];
    const keys = rows.map((row) => [...row.names]);
    const values = rows.map((row) => [...row.data]);

    // The get method returns a column using name lookup.
    expect(values).toEqual(rows.map((row) => [row.get('i')]));

    // Keys are column names.
    expect(keys).toEqual(expectation.map(() => ['i']));

    // Values are row values.
    expect(values).toEqual(expectation.map((i) => [i]));

    // We could iterate multiple times over the same result.
    let count = 0;
    const result = query();
    for await (const _ of result) {
        count += 1;
    };
    expect(count).toEqual(10);

    for await (const _ of result) {
        count += 1;
    };
    expect(count).toEqual(20);

    // The result is also available in the public rows attribute.
    expect(result.rows).toEqual(
        expectation.map((i) => { return [i] })
    );

}

describe('Result', () => {
    testWithClient('Names', async (client) => {
        expect.assertions(2);
        let result = await client.query(
            'select $1::text as message', ['Hello world!']
        );
        expect(result.names.length).toEqual(1);
        expect(result.names[0]).toEqual('message');
    });

    testWithClient('Synchronous iteration', async (client) => {
        await testIteratorResult(
            client,
            async (p) => {
                return p.then((result) => {
                    const rows: ResultRow<Value>[] = [];
                    for (const row of result) {
                        rows.push(row);
                    };
                    return rows;
                });
            });
    });

    testWithClient('Asynchronous iteration', async (client) => {
        await testIteratorResult(
            client,
            async (result) => {
                const rows: ResultRow<Value>[] = [];
                for await (const row of result) {
                    rows.push(row);
                };
                return rows;
            });
    });
});

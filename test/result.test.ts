import { testWithClient } from './helper';
import { Client, ResultIterator, ResultRow } from '../src/client';

type ResultFunction =
    (result: ResultIterator) =>
        Promise<ResultRow[]>;

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

    testWithClient('Get', async (client) => {
        expect.assertions(3);
        let result = await client.query(
            'select $1::text as message', ['Hello world!']
        );
        expect(result.status).toEqual('SELECT 1');
        const rows = [...result];
        const row = rows[0];
        expect(row.get('message')).toEqual('Hello world!');
        expect(row.get('bad')).toEqual(undefined);
    });

    testWithClient('One', async (client) => {
        expect.assertions(1);
        let row = await client.query(
            'select $1::text as message', ['Hello world!']
        ).one();
        expect(row.get('message')).toEqual('Hello world!');
    });

    testWithClient('One (empty query)', async (client) => {
        expect.assertions(1);
        await expect(client.query('select true where false').one())
            .rejects.toThrow(/empty/);
    });

    testWithClient('First (error)', async (client) => {
        const query = client.query('select does-not-exist');
        return expect(query.first()).rejects.toMatchObject({
            message: 'column "does" does not exist'
        })
    });

    testWithClient('One (error)', async (client) => {
        const query = client.query('select does-not-exist');
        return expect(query.one()).rejects.toMatchObject({
            message: 'column "does" does not exist'
        })
    });

    testWithClient('Synchronous iteration', async (client) => {
        await testIteratorResult(
            client,
            async (p) => {
                return p.then((result) => {
                    const rows: ResultRow[] = [];
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
                const rows: ResultRow[] = [];
                for await (const row of result) {
                    rows.push(row);
                };
                return rows;
            });
    });
});

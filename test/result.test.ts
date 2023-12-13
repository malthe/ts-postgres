import { describe, expect } from '@jest/globals';
import { testWithClient } from './helper';
import { Client, ResultIterator, ResultRow } from '../src/index';

type ResultFunction<T> = (result: ResultIterator<T>) => Promise<T[]>;

async function testIteratorResult<T>(client: Client, f: ResultFunction<T>) {
    const query = () => client.query<T>(
        'select generate_series($1::int, $2::int) as i', [0, 9]
    );
    const iterator = query();
    const items = await f(iterator);
    //const result = await iterator;

    expect(items.length).toEqual(10);
    expect(items).toEqual([...Array(10).keys()].map(i => ({i: i})));

    const result = await iterator;
    expect(result.names).toEqual(['i']);

    let count = 0;

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    for await (const _ of iterator) {
        count += 1;
    }
    expect(count).toEqual(10);

    // We could iterate multiple times over the same result.
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    for await (const _ of iterator) {
        count += 1;
    }
    expect(count).toEqual(20);
}

describe('Result', () => {
    testWithClient('Default type', async (client) => {
        expect.assertions(7);
        const result = await client.query(
            'select $1::text as message', ['Hello world!']
        );
        expect(result.status).toEqual('SELECT 1');
        expect(result.names.length).toEqual(1);
        expect(result.names[0]).toEqual('message');
        expect([...result]).toEqual([{message: 'Hello world!'}]);
        const rows = [...result];
        const row = rows[0];
        expect(row.message).toEqual('Hello world!');
        expect(row.bad).toEqual(undefined);
        const mapped = result.rows[0].reify();
        expect(mapped.message).toEqual('Hello world!');
    });

    testWithClient('Typed', async (client) => {
        expect.assertions(3);
        type T = {
            message: string
        };
        const result = await client.query<T>(
            'select $1::text as message', ['Hello world!']
        );
        expect(result.status).toEqual('SELECT 1');
        const rows = [...result];
        const row: ResultRow<T> = result.rows[0];
        const obj: T = rows[0];
        expect(row.get('message')).toEqual('Hello world!');
        expect(obj.message).toEqual('Hello world!');
    });

    testWithClient('Parse array containing null', async (client) => {
        expect.assertions(1);
        const row = await client.query(
            'select ARRAY[null::text] as a'
        ).one();
        expect(row.a).toEqual([null]);
    });

    testWithClient('Format array containing null value', async (client) => {
        expect.assertions(1);
        const row = await client.query(
            'select $1::text[] as a', [[null]]
        ).one();
        expect(row.a).toEqual([null]);
    });

    testWithClient('Format null-array', async (client) => {
        expect.assertions(1);
        const row = await client.query(
            'select $1::text[] as a', [null]
        ).one();
        expect(row.a).toEqual(null);
    });

    testWithClient('One', async (client) => {
        expect.assertions(1);
        const row = await client.query(
            'select $1::text as message', ['Hello world!']
        ).one();
        expect(row.message).toEqual('Hello world!');
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

    testWithClient('Multiple null params', async (client) => {
        expect.assertions(3);
        const row = await client.query(
            'select $1::text as a, $2::text[] as b, $3::jsonb[] as c',
            [null, null, null]
        ).one();
        expect(row.a).toBeNull()
        expect(row.b).toBeNull();
        expect(row.c).toBeNull();
    });

    testWithClient('Synchronous iteration', async (client) => {
        await testIteratorResult(
            client,
            async (p) => {
                return p.then((result) => {
                    const rows = [];
                    for (const row of result) {
                        rows.push(row);
                    }
                    return rows;
                });
            });
    });

    testWithClient('Asynchronous iteration', async (client) => {
        await testIteratorResult(
            client,
            async (result) => {
                const rows = [];
                for await (const row of result) {
                    rows.push(row);
                }
                return rows;
            });
    });

    testWithClient('Null typed array', async (client) => {
        expect.assertions(1);
        const row = await client.query('select null::text[] as value').one();
        expect(row.value).toBeNull();
    });
});

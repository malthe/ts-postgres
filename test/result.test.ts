import { equal, deepEqual, rejects, strictEqual } from 'node:assert';
import { describe } from 'node:test';
import { test } from './helper';
import { Client, ResultIterator, ResultRow } from '../src/index';

type ResultFunction<T> = (result: ResultIterator<T>) => Promise<T[]>;

async function testIteratorResult<T>(client: Client, f: ResultFunction<T>) {
    const query = () => client.query<T>(
        'select generate_series($1::int, $2::int) as i', [0, 9]
    );
    const iterator = query();
    const items = await f(iterator);
    //const result = await iterator;

    equal(items.length, 10);
    deepEqual(items, [...Array(10).keys()].map(i => ({i: i})));

    const result = await iterator;
    deepEqual(result.names, ['i']);

    let count = 0;

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    for await (const _ of iterator) {
        count += 1;
    }
    equal(count, 10);

    // We could iterate multiple times over the same result.
    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    for await (const _ of iterator) {
        count += 1;
    }
    equal(count, 20);
}

describe('Result', () => {
    test('Default type', async ({ client }) => {
        const result = await client.query(
            'select $1::text as message', ['Hello world!']
        );
        equal(result.status, 'SELECT 1');
        equal(result.names.length, 1);
        equal(result.names[0], 'message');
        deepEqual([...result], [{message: 'Hello world!'}]);
        const rows = [...result];
        const row = rows[0];
        equal(row.message, 'Hello world!');
        equal(row.bad, undefined);
        const mapped = result.rows[0].reify();
        equal(mapped.message, 'Hello world!');
    });

    test('Typed', async ({ client }) => {
        type T = {
            message: string
        };
        const result = await client.query<T>(
            'select $1::text as message', ['Hello world!']
        );
        equal(result.status, 'SELECT 1');
        const rows = [...result];
        const row: ResultRow<T> = result.rows[0];
        const obj: T = rows[0];
        equal(row.get('message'), 'Hello world!');
        equal(obj.message, 'Hello world!');
    });

    test('Parse array containing null', async ({ client }) => {
        const row = await client.query(
            'select ARRAY[null::text] as a'
        ).one();
        deepEqual(row.a, [null]);
    });

    test('Format array containing null value', async ({ client }) => {
        const row = await client.query(
            'select $1::text[] as a', [[null]]
        ).one();
        deepEqual(row.a, [null]);
    });

    test('Format null-array', async ({ client }) => {
        const row = await client.query(
            'select $1::text[] as a', [null]
        ).one();
        equal(row.a, null);
    });

    test('One', async ({ client }) => {
        const row = await client.query(
            'select $1::text as message', ['Hello world!']
        ).one();
        equal(row.message, 'Hello world!');
    });

    test('One (empty query)', async ({ client }) => {
        await rejects(
            client.query('select true where false').one(),
            /empty/
        );
    });

    test('First (error)', async ({ client }) => {
        const query = client.query('select does-not-exist');
        return rejects(query.first(), {
            message: 'column "does" does not exist'
        });
    });

    test('One (error)', async ({ client }) => {
        const query = client.query('select does-not-exist');
        return rejects(query.one(), {
            message: 'column "does" does not exist'
        });
    });

    test('Multiple null params', async ({ client }) => {
        const row = await client.query(
            'select $1::text as a, $2::text[] as b, $3::jsonb[] as c',
            [null, null, null]
        ).one();
        strictEqual(row.a, null);
        strictEqual(row.b, null);
        strictEqual(row.c, null);
    });

    test('Synchronous iteration', async ({ client }) => {
        await testIteratorResult(
            client,
            async (p) => {
                return p.then((result) => {
                    const rows: unknown[] = [];
                    for (const row of result) {
                        rows.push(row);
                    }
                    return rows;
                });
            });
    });

    test('Asynchronous iteration', async ({ client }) => {
        await testIteratorResult(
            client,
            async (result) => {
                const rows: unknown[] = [];
                for await (const row of result) {
                    rows.push(row);
                }
                return rows;
            });
    });

    test('Null typed array', async ({ client }) => {
        const row = await client.query('select null::text[] as value').one();
        equal(row.value, null);
    });
});

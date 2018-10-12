import { withClient } from './helper';
import { DataType, Row } from '../src/types';
import { Result } from '../src/result';

describe('Result', withClient([
    (client) => {
        test('Row map', async () => {
            expect.assertions(2);
            let result = await client.query(
                'select $1::text as message', ['Hello world!']
            ).asMapArray();
            expect(result.length).toEqual(1);
            expect(result[0].get('message')).toEqual('Hello world!');
        });
    },
    (client) => {
        test('Multiple iterations over same result', async () => {
            expect.assertions(5);
            let result = client.query(
                'select generate_series($1::int, $2::int)', [0, 9]
            );
            let count = 0;
            let rows: Row[] = [];

            for await (const row of result) {
                rows.push(row);
                count += 1;
            };

            let expectation = [...Array(10).keys()];

            expect(count).toEqual(10);
            expect(rows.length).toEqual(10);
            expect(([] as Row[]).concat(...rows)).
                toEqual(expectation);

            // We could iterate once again over the same set of data.
            for await (const row of result) {
                count += 1;
            };

            expect(count).toEqual(20);

            // The result is also available in the public rows attribute.
            expect(result.rows).toEqual(
                expectation.map((i) => { return [i] })
            );
        });
    }
]));

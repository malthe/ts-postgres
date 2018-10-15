import { withClient, Test } from './helper';
import { Client } from '../src/client';

import {
    DataType,
    JsonMap,
    Point,
    Value
} from '../src/types';

const infinity = Number('Infinity');


function getComparisonQueryFor(dataType: DataType, expression: string) {
    switch (dataType) {
        case DataType.ArrayJson:
            return `select ($1)::jsonb[] <@ (${expression})::jsonb[]`;
        case DataType.Json:
            return `select ($1)::jsonb <@ (${expression})::jsonb`;
        case DataType.Point:
            return `select $1 ~= ${expression}`;
        default:
            return `select $1 = ${expression}`;
    }
}

function make<T extends Value>(
    dataType: DataType, expression: string, expected: T): Test[] {
    const testParam = (client: Client) => {
        test(`Param: ${expression} (${dataType})`, async () => {
            expect.assertions(3);
            const query = getComparisonQueryFor(dataType, expression);
            await client.query(query, [expected], [dataType]).then(
                (result) => {
                    const rows = result.rows;
                    expect(rows.length).toEqual(1);
                    expect(rows[0].length).toEqual(1);
                    expect(rows[0][0]).toEqual(true)
                });
        })
    };

    const testValue = (client: Client) => {
        test(`Value: ${expression} (${dataType})`, async () => {
            expect.assertions(3);
            const query = 'select ' + expression;
            await client.query(query, []).then(
                (result) => {
                    const rows = result.rows;
                    expect(rows.length).toEqual(1);
                    expect(rows[0].length).toEqual(1);
                    expect(rows[0][0]).toEqual(expected)
                });
        })
    };

    return [
        (client) => { testParam(client); },
        (client) => { testValue(client); },
    ];
}

function utc_date(...rest: number[]) {
    return new Date(Date.UTC.apply(null, rest));
}

describe('Types', withClient(
    (([] as Test[]).concat(...([
        make<boolean>(DataType.Bool, 'true', true),
        make<boolean>(DataType.Bool, 'false', false),
        make<string>(DataType.Bpchar, '\'abc\'::char(3)', 'abc'),
        make<string>(DataType.Char, '\'a\'::char(1)', 'a'),
        make<string>(DataType.Text, '\'a\'::text', 'a'),
        make<number>(DataType.Int2, '1::int2', 1),
        make<number>(DataType.Int4, '1::int4', 1),
        make<null>(DataType.Int8, '1::int8', null),
        make<number>(DataType.Float4, '1::float4', 1.0),
        make<number>(DataType.Float8, '1::float8', 1.0),
        make<null>(DataType.Numeric, '1::numeric', null),
        make<number>(DataType.Oid, '1::oid', 1),
        make<number>(DataType.Date, '\'infinity\'::date', infinity),
        make<number>(DataType.Date, '\'-infinity\'::date', -infinity),
        make<Date>(
            DataType.Date,
            '\'2000-01-01\'::date',
            utc_date(2000, 0, 1)),
        make<Date>(
            DataType.Date,
            '\'1999-12-31\'::date',
            utc_date(1999, 11, 31)),
        make<Date>(
            DataType.Date,
            '\'1998-12-31\'::date',
            utc_date(1998, 11, 31)),
        make<Date>(
            DataType.Date,
            '\'2001-12-31\'::date',
            utc_date(2001, 11, 31)),
        make<number>(
            DataType.Timestamp, '\'infinity\'::timestamp', infinity),
        make<number>(
            DataType.Timestamp, '\'-infinity\'::timestamp', -infinity),
        make<Date>(
            DataType.Timestamptz,
            '\'2000-01-01 00:00:00\'::timestamp at time zone \'utc\'',
            utc_date(2000, 0, 1, 0, 0, 0, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'1999-12-31 23:59:59.990\'::timestamp at time zone \'utc\'',
            utc_date(1999, 11, 31, 23, 59, 59, 990)),
        make<Date>(
            DataType.Timestamptz,
            '\'1970-01-01 00:00:00.000\'::timestamp at time zone \'utc\'',
            utc_date(1970, 0, 1, 0, 0, 0, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'2001-01-01 00:00:00\'::timestamp at time zone \'utc\'',
            utc_date(2001, 0, 1, 0, 0, 0, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'2000-01-01 00:00:00\'::timestamp at time zone \'utc\'',
            utc_date(2000, 0, 1, 0, 0, 0, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'1999-12-31 23:59:59.000\'::timestamp at time zone \'utc\'',
            utc_date(1999, 11, 31, 23, 59, 59, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'1999-12-31 23:59:59Z\'::timestamptz',
            utc_date(1999, 11, 31, 23, 59, 59)),
        make<Date>(
            DataType.Timestamptz,
            '\'1970-01-01 00:00:00Z\'::timestamptz',
            utc_date(1970, 0, 1, 0, 0, 0)),
        make<Date>(
            DataType.Timestamptz,
            '\'1893-03-31 22:46:55+00:53:27\'::timestamptz',
            utc_date(1893, 2, 31, 21, 53, 28)),
        make<Date>(
            DataType.Date,
            '\'0002-12-31 BC\'::date',
            utc_date(-1, 11, 31)),
        make<Point>(
            DataType.Point,
            '\'(1,2)\'::Point',
            { x: 1, y: 2 }),
        make<number[]>(
            DataType.ArrayInt4,
            '\'{1,2,3}\'::int4[3]',
            [1, 2, 3]),
        make<number[]>(
            DataType.ArrayInt4,
            '\'{42}\'::int4[3]',
            [42]),
        make<number[][][]>(
            DataType.ArrayInt4,
            '\'{{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}}\'::int4[]',
            [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]),
        make<number[]>(
            DataType.ArrayFloat4,
            '\'{1.0, 2.0, 3.0}\'::float4[3]',
            [1.0, 2.0, 3.0]),
        make<number[]>(
            DataType.ArrayFloat4,
            '\'{1.125,2.250,3.375}\'::float4[3]',
            [1.125, 2.250, 3.375]),
        make<number[]>(
            DataType.ArrayFloat4,
            '\'{16777217.0}\'::float4[1]',
            [2 ** 24]),
        make<number[]>(
            DataType.ArrayFloat8,
            '\'{16777217.0}\'::float8[1]',
            [2 ** 24 + 1]),
        make<string[]>(
            DataType.ArrayVarchar, '\'{abc}\'::varchar[]', ['abc']),
        make<string[]>(
            DataType.ArrayVarchar, '\'{"\\"abc\\""}\'::varchar[]', ['"abc"']),
        make<string[]>(
            DataType.ArrayVarchar, '\'{"Ŝќ⽜"}\'::varchar[]', ['Ŝќ⽜']),
        make<string[]>(
            DataType.ArrayBpchar, '\'{a}\'::bpchar[]', ['a']),
        make<string[]>(
            DataType.ArrayText, '\'{a}\'::text[]', ['a']),
        make<Date[]>(
            DataType.ArrayDate,
            '\'{2000-01-01}\'::date[]',
            [utc_date(2000, 0, 1)]),
        make<number[]>(
            DataType.ArrayTimestamp,
            'ARRAY[\'infinity\'::timestamp]',
            [infinity]),
        make<Date[]>(
            DataType.ArrayTimestamptz,
            'ARRAY[\'1999-12-31 23:59:59\'::timestamp at time zone \'utc\']',
            [utc_date(1999, 11, 31, 23, 59, 59)]),
        make<Date[]>(
            DataType.ArrayTimestamptz,
            '\'{1999-12-31 23:59:59Z}\'::timestamptz[]',
            [utc_date(1999, 11, 31, 23, 59, 59)]),
        make<JsonMap>(
            DataType.Json,
            '\'{"foo": "bar"}\'::json',
            { 'foo': 'bar' }),
        make<JsonMap[]>(
            DataType.ArrayJson,
            'ARRAY[\'{"foo": "bar"}\'::json]',
            [{ 'foo': 'bar' }])
    ])))));

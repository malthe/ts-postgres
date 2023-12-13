import { describe, expect } from '@jest/globals';
import { testWithClient } from './helper';

import {
    DataType,
    Point,
    DataFormat
} from '../src';

const infinity = Number('Infinity');


function getComparisonQueryFor(dataType: DataType, expression: string) {
    switch (dataType) {
        case DataType.ArrayJson:
            return `select ($1)::jsonb[] <@ (${expression})::jsonb[]`;
        case DataType.Jsonb:
        case DataType.Json:
            return `select ($1)::jsonb <@ (${expression})::jsonb`;
        case DataType.Point:
            return `select $1 ~= ${expression}`;
        default:
            return `select $1 = ${expression}`;
    }
}

function testType<T>(
    dataType: DataType,
    expression: string,
    expected: T,
    excludeTextMode = false,
    bigints?: boolean) {
    const testParam = (format: DataFormat) => {
        testWithClient('Param', async (client) => {
            expect.assertions(3);
            const text = expected !== null
                ? getComparisonQueryFor(dataType, expression) + ' where $1 is not null'
                : 'select $1 is null';
            await client.query({
                text,
                types: [dataType],
                format,
                bigints,
            }, [expected])
                .then(
                    (result) => {
                        const rows = result.rows;
                        expect(rows.length).toEqual(1);
                        expect(rows[0].length).toEqual(1);
                        expect(rows[0][0]).toEqual(true)
                    });
        })
    };

    const testValue = (format: DataFormat) => {
        testWithClient('Value', async (client) => {
            expect.assertions(3);
            const text = 'select ' + expression;
            await client.query({text, format, bigints}, []).then(
                (result) => {
                    const rows = result.rows;
                    expect(rows.length).toEqual(1);
                    expect(rows[0].length).toEqual(1);
                    expect(rows[0][0]).toEqual(expected);
                });
        })
    };

    describe(`${expression} (${dataType}/binary)`, () => {
        testParam(DataFormat.Binary);
        testValue(DataFormat.Binary);
    });

    if (!excludeTextMode) {
        describe(`${expression} (${dataType}/text)`, () => {
            testParam(DataFormat.Text);
            testValue(DataFormat.Text);
        });
    }
}

function utc_date(...rest: [
    number,
    number,
    number?,
    number?,
    number?,
    number?,
    number?]) {
    return new Date(Date.UTC.apply(null, rest));
}

describe('Types', () => {
    testType<boolean>(DataType.Bool, 'true', true);
    testType<boolean>(DataType.Bool, 'false', false);
    testType<string>(DataType.Bpchar, '\'abc\'::char(3)', 'abc');
    testType<Buffer>(
        DataType.Bytea,
        '\'abc\'::bytea',
        Buffer.from('abc'));
    testType<string>(DataType.Char, '\'a\'::char(1)', 'a');
    testType<string>(DataType.Text, '\'a\'::text', 'a');
    testType<number>(DataType.Int2, '1::int2', 1);
    testType<number>(DataType.Int4, '1::int4', 1);
    testType<bigint>(DataType.Int8, '1::int8', BigInt(1));
    testType<number>(DataType.Int8, '1::int8', 1, undefined, false);
    testType<number>(DataType.Float4, '1::float4', 1.0);
    testType<number>(DataType.Float8, '1::float8', 1.0);
    testType<number>(DataType.Oid, '1::oid', 1);
    testType<number>(DataType.Date, '\'infinity\'::date', infinity);
    testType<number>(DataType.Date, '\'-infinity\'::date', -infinity);
    testType<Date>(
        DataType.Date,
        '\'2000-01-01\'::date',
        utc_date(2000, 0, 1));
    testType<Date>(
        DataType.Date,
        '\'1999-12-31\'::date',
        utc_date(1999, 11, 31));
    testType<Date>(
        DataType.Date,
        '\'1998-12-31\'::date',
        utc_date(1998, 11, 31));
    testType<Date>(
        DataType.Date,
        '\'2001-12-31\'::date',
        utc_date(2001, 11, 31));
    testType<number>(
        DataType.Timestamp, '\'infinity\'::timestamp', infinity);
    testType<number>(
        DataType.Timestamp, '\'-infinity\'::timestamp', -infinity);
    testType<Date>(
        DataType.Timestamptz,
        '\'2000-01-01 00:00:00\'::timestamp at time zone \'utc\'',
        utc_date(2000, 0, 1, 0, 0, 0, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'1999-12-31 23:59:59.990\'::timestamp at time zone \'utc\'',
        utc_date(1999, 11, 31, 23, 59, 59, 990));
    testType<Date>(
        DataType.Timestamptz,
        '\'1970-01-01 00:00:00.000\'::timestamp at time zone \'utc\'',
        utc_date(1970, 0, 1, 0, 0, 0, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'2001-01-01 00:00:00\'::timestamp at time zone \'utc\'',
        utc_date(2001, 0, 1, 0, 0, 0, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'2000-01-01 00:00:00\'::timestamp at time zone \'utc\'',
        utc_date(2000, 0, 1, 0, 0, 0, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'1999-12-31 23:59:59.000\'::timestamp at time zone \'utc\'',
        utc_date(1999, 11, 31, 23, 59, 59, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'1999-12-31 23:59:59Z\'::timestamptz',
        utc_date(1999, 11, 31, 23, 59, 59));
    testType<Date>(
        DataType.Timestamptz,
        '\'1970-01-01 00:00:00Z\'::timestamptz',
        utc_date(1970, 0, 1, 0, 0, 0));
    testType<Date>(
        DataType.Timestamptz,
        '\'1893-03-31 22:46:55+00:53:27\'::timestamptz',
        utc_date(1893, 2, 31, 21, 53, 28));
    testType<Date>(
        DataType.Date,
        '\'0002-12-31 BC\'::date',
        utc_date(-1, 11, 31));
    testType<(Date | null)[]>(
        DataType.ArrayTimestamptz,
        'ARRAY[null,\'1999-12-31 23:59:59Z\']::timestamptz[]',
        [null, utc_date(1999, 11, 31, 23, 59, 59)]);
    testType<(Date | null)[][]>(
        DataType.ArrayTimestamptz,
        'ARRAY[ARRAY[null],ARRAY[\'1999-12-31 23:59:59Z\']]::timestamptz[][]',
        [[null], [utc_date(1999, 11, 31, 23, 59, 59)]]);
    testType<Point>(
        DataType.Point,
        '\'(1,2)\'::Point',
        { x: 1, y: 2 },
        true);
    testType<string>(
        DataType.Uuid,
        '\'123e4567-e89b-12d3-a456-426655440000\'::uuid',
        '123e4567-e89b-12d3-a456-426655440000'
    );
    testType<string[]>(
        DataType.ArrayUuid,
        'ARRAY[\'123e4567-e89b-12d3-a456-426655440000\'::uuid]',
        ['123e4567-e89b-12d3-a456-426655440000']
    );
    testType<number[]>(
        DataType.ArrayInt2,
        '\'{1,2,3}\'::int2[3]',
        [1, 2, 3]);
    testType<number[]>(
        DataType.ArrayInt4,
        '\'{1,2,3}\'::int4[3]',
        [1, 2, 3]);
    testType<number[]>(
        DataType.ArrayInt4,
        '\'{42}\'::int4[3]',
        [42]);
    testType<number[][][]>(
        DataType.ArrayInt4,
        '\'{{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}}\'::int4[]',
        [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
    testType<bigint[]>(
        DataType.ArrayInt8,
        '\'{1,2,3}\'::int8[3]',
        [BigInt(1), BigInt(2), BigInt(3)]);
    testType<number[]>(
        DataType.ArrayInt8,
        '\'{1,2,3}\'::int8[3]',
        [1, 2, 3],
        undefined,
        false);
    testType<number[]>(
        DataType.ArrayFloat4,
        '\'{1.0, 2.0, 3.0}\'::float4[3]',
        [1.0, 2.0, 3.0]);
    testType<number[]>(
        DataType.ArrayFloat4,
        '\'{1.125,2.250,3.375}\'::float4[3]',
        [1.125, 2.250, 3.375]);
    testType<number[]>(
        DataType.ArrayFloat4,
        '\'{16777217.0}\'::float4[1]',
        [2 ** 24]);
    testType<number[]>(
        DataType.ArrayFloat8,
        '\'{16777217.0}\'::float8[1]',
        [2 ** 24 + 1]);
    testType<string[]>(
        DataType.ArrayVarchar, '\'{abc}\'::varchar[]', ['abc']);
    testType<string[]>(
        DataType.ArrayVarchar,
        '\'{"\\"abc\\""}\'::varchar[]',
        ['"abc"']);
    testType<string[]>(
        DataType.ArrayVarchar, '\'{"Ŝќ⽜"}\'::varchar[]', ['Ŝќ⽜']);
    testType<string[]>(
        DataType.ArrayBpchar, '\'{a}\'::bpchar[]', ['a']);
    testType<Buffer[]>(
        DataType.ArrayBytea, '\'{abc}\'::bytea[]', [Buffer.from('abc')]);
    testType<string[]>(
        DataType.ArrayText, '\'{a}\'::text[]', ['a']);
    testType<string[]>(
        DataType.ArrayText, '\'{"a,"}\'::text[]', ['a,']);
    testType<(string | null)[]>(
        DataType.ArrayText,
        'ARRAY[null]::text[]',
        [null]
    );
    testType<(string | null)[]>(
        DataType.ArrayText,
        `ARRAY['a', null, 'b', null]::text[]`,
        ['a', null, 'b', null]
    );
    testType<(string | null)[][]>(
        DataType.ArrayText,
        `ARRAY[ARRAY['a',null,'b'],ARRAY[null, 'c', null]]::text[][]`,
        [['a', null, 'b'], [null, 'c', null]]
    );
    testType<Date[]>(
        DataType.ArrayDate,
        '\'{2000-01-01}\'::date[]',
        [utc_date(2000, 0, 1)]);
    testType<number[]>(
        DataType.ArrayTimestamp,
        'ARRAY[\'infinity\'::timestamp]',
        [infinity]);
    testType<Date[]>(
        DataType.ArrayTimestamptz,
        'ARRAY[\'1999-12-31 23:59:59\'::timestamp at time zone \'utc\']',
        [utc_date(1999, 11, 31, 23, 59, 59)]);
    testType<Date[]>(
        DataType.ArrayTimestamptz,
        '\'{1999-12-31 23:59:59Z}\'::timestamptz[]',
        [utc_date(1999, 11, 31, 23, 59, 59)]);
    testType<Record<string, any>>(
        DataType.Json,
        '\'{"foo": "bar"}\'::json',
        { 'foo': 'bar' });
    testType<Record<string, any>>(
        DataType.Jsonb,
        '\'{"foo": "bar"}\'::jsonb',
        { 'foo': 'bar' });
    testType<Record<string, any>[]>(
        DataType.ArrayJsonb,
        'ARRAY[\'{"foo": "bar"}\'::jsonb, \'{"bar": "baz"}\'::jsonb]',
        [{ 'foo': 'bar' }, { 'bar': 'baz' }]);
    testType<Record<string, any>[]>(
        DataType.ArrayJson,
        'ARRAY[\'{"foo": "bar"}\'::json]',
        [{ 'foo': 'bar' }]);
    // Test nulls
    testType<boolean | null>(
        DataType.Bool,
        'null::bool',
        null
    );
    testType<string | null>(
        DataType.Uuid,
        'null::uuid',
        null
    );
    testType<string | null>(
        DataType.Text,
        'null::text',
        null
    );
    testType<string[] | null>(
        DataType.ArrayText,
        'null::text[]',
        null
    );
    testType<string[][] | null>(
        DataType.ArrayText,
        'null::text[][]',
        null
    );
    testType<Date | null>(
        DataType.ArrayTimestamptz,
        'null::timestamptz',
        null);
    testType<Date[] | null>(
        DataType.ArrayTimestamptz,
        'null::timestamptz[]',
        null);
    testType<Date[] | null>(
        DataType.ArrayTimestamptz,
        'null::timestamptz[][]',
        null);
});

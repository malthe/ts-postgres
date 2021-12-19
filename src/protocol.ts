import { Socket } from 'net';
import { Writable } from 'stream';
import { ElasticBuffer } from './buffer';
import { postgresqlErrorCodes } from './errors';
import { hi, hmacSha256, sha256, xorBuffers } from './sasl';
import { sum } from './utils';
import {
    arrayDataTypeMapping,
    isPoint,
    ArrayValue,
    DataFormat,
    DataType,
    Primitive,
    Value,
    ValueTypeReader
} from './types';

const arrayMask = 1 << 31;
const readerMask = 1 << 29;
const infinity = Number('Infinity');
const timeshift = 946684800000;
const isUndefined = Object.is.bind(null, undefined);

export const enum Command {
    Bind = 0x42,
    Close = 0x43,
    Describe = 0x44,
    End = 0x58,
    Execute = 0x45,
    Flush = 0x48,
    Parse = 0x50,
    Password = 0x70,
    Query = 0x51,
    Sync = 0x53,
    SASLResponse = 0x70
}

export enum ErrorLevel {
    error = 'ERROR',
    fatal = 'FATAL',
    panic = 'PANIC'
}

export const enum Message {
    Authentication = 0x52,
    BackendKeyData = 0x4b,
    BindComplete = 0x32,
    CloseComplete = 0x33,
    CommandComplete = 0x43,
    EmptyQueryResponse = 0x49,
    ErrorResponse = 0x45,
    NoData = 0x6e,
    Notice = 0x4e,
    NotificationResponse = 0x41,
    ParseComplete = 0x31,
    ParameterDescription = 0x74,
    ParameterStatus = 0x53,
    ReadyForQuery = 0x5a,
    RowData = 0x44,
    RowDescription = 0x54
}

export const enum SSLResponseCode {
    Supported = 0x53,
    NotSupported = 0x4e,
}

export const enum TransactionStatus {
    Idle = 0x49,
    InTransaction = 0x54,
    InError = 0x45
}

export type SegmentValue = Buffer | BigInt | number | null | string;
export type Segment = [SegmentType, SegmentValue];

export const enum SegmentType {
    Buffer,
    Float4,
    Float8,
    Int8,
    Int16BE,
    Int32BE,
    Int64BE,
    UInt32BE
}

export interface RowDescription {
    columns: Uint32Array,
    names: string[]
}

export interface StartupConfiguration {
    user: string,
    database: string,
    extraFloatDigits: number
}

export class DatabaseError extends Error {
    constructor(
        public level: ErrorLevel,
        public code: keyof typeof postgresqlErrorCodes,
        public message: string
    ) {
        super(message);
        const actualProto = new.target.prototype;

        if (Object.setPrototypeOf) {
            Object.setPrototypeOf(this, actualProto);
        } else {
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            (this as any).__proto__ = actualProto;
        }
    }
}

export type Receive = (buffer: Buffer, offset: number, size: number) => number;

const nullBuffer = Buffer.from('null');

function dateToStringUTC(date: Date, includeTime: boolean) {
    const pad = (n: number, length: number) =>
        n.toString().padStart(length, '0');

    const year = date.getUTCFullYear();
    const isBC = year < 0;

    let result =
        pad(isBC ? (1 - year) : year, 4) + '-' +
        pad(date.getUTCMonth() + 1, 2) + '-' +
        pad(date.getUTCDate(), 2);

    if (includeTime) {
        result +=
            'T' +
            pad(date.getUTCHours(), 2) + ':' +
            pad(date.getUTCMinutes(), 2) + ':' +
            pad(date.getUTCSeconds(), 2) + '.' +
            pad(date.getUTCMilliseconds(), 3) +
            '+00:00';
    }

    if (isBC) {
        result += ' BC';
    }

    return result;
}

function formatUuid(bytes: Buffer) {
    const slice = (start: number, end: number) => {
        return bytes.slice(start, end).toString('hex');
    }

    return [
        slice(0, 4),
        slice(4, 6),
        slice(6, 8),
        slice(8, 10),
        slice(10, 16)
    ].join('-');
}

function parseUuid(uuid: string) {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function makeBuffer(
    s: string, encoding?: BufferEncoding, nullTerminate = false):
    SegmentValue {
    return Buffer.from(nullTerminate ? s + '\0' : s, encoding);
}

function makeBufferSegment(
    s: string, encoding?: BufferEncoding, nullTerminate = false): Segment {
    return [SegmentType.Buffer, makeBuffer(s, encoding, nullTerminate)];
}

function getSegmentSize(segment: SegmentType, value: SegmentValue) {
    switch (segment) {
        case SegmentType.Buffer: {
            if (value instanceof Buffer) {
                return value.length;
            } else {
                break;
            }
        }
        case SegmentType.Int64BE:
        case SegmentType.Float8: {
            return 8;
        }
        case SegmentType.Int8: {
            return 1;
        }
        case SegmentType.Int16BE: {
            return 2;
        }
        case SegmentType.Float4:
        case SegmentType.Int32BE:
        case SegmentType.UInt32BE: {
            return 4;
        }
    }
    return -1;
}

function getMessageSize(code: number | null, segments: Segment[]) {
    // Messages are composed of a one byte message code plus a
    // 32-bit message length.
    let size = 4 + (code ? 1 : 0);

    // Precompute total message size.
    const length = segments.length;
    for (let i = 0; i < length; i++) {
        const [segment, value] = segments[i];
        size += Math.max(getSegmentSize(segment, value), 0);
    }

    return size;
}

export function readRowDescription(
    buffer: Buffer,
    start: number,
    types?: ReadonlyMap<DataType, ValueTypeReader>) {
    let offset = start;
    const length = buffer.readInt16BE(offset);
    const columns = new Uint32Array(length);
    const names = new Array<string>(length);
    offset += 2;
    let i = 0;

    while (i < length) {
        const j = buffer.indexOf('\0', offset);
        const name = buffer.slice(offset, j).toString();
        const dataType = buffer.readInt32BE(j + 7);
        const innerDataType = arrayDataTypeMapping.get(dataType);
        const isArray = (typeof innerDataType !== 'undefined');
        const typeReader = (types) ? types.get(dataType) : undefined;

        columns[i] =
            ((innerDataType || dataType))
            | ((isArray) ? arrayMask : 0)
            | (typeReader ? readerMask : 0);

        names[i] = name;

        i++;
        offset = j + 19;
    }

    return {
        columns: columns,
        names: names
    }
}


export function readRowData(
    buffer: Buffer,
    row: Array<Value>,
    columnSpecification: Uint32Array,
    encoding: BufferEncoding,
    types: ReadonlyMap<DataType, ValueTypeReader> | null,
    streams: ReadonlyArray<Writable | null> | null,
): number {
    const columns = row.length;
    const bufferLength = buffer.length;

    // Find the row index (i.e., column) that's undefined which is
    // where we start reading row data.
    let i = row.findIndex(isUndefined);
    let offset = 0;

    while (i < columns) {
        // Must have enough data available to read column size.
        const start = offset + 4;
        if (bufferLength < start) break;

        const j = i;
        i++;

        const length = buffer.readInt32BE(offset);

        // If the length is reported as -1, this means a NULL value.
        const dataLength = (length >= 0 ? length : 0);

        const end = start + dataLength;
        const remaining = end - bufferLength;
        const partial = remaining > 0;

        let value: Value = null;

        if (start < end) {
            const spec = columnSpecification[j];
            let skip = false;

            if (streams !== null && spec === DataType.Bytea) {
                const stream = streams[j];
                if (stream !== null) {
                    const slice = buffer.slice(start, end);
                    const alloc = Buffer.allocUnsafe(slice.length);
                    slice.copy(alloc, 0, 0, slice.length);
                    stream.write(alloc);
                    buffer.writeInt32BE(length - alloc.length, bufferLength - 4);

                    if (partial) {
                        return bufferLength - 4;
                    }

                    skip = true;
                }
            }

            if (partial) {
                break;
            }

            if (!skip) {
                const dataType: DataType =
                    spec &
                    ~arrayMask &
                    ~readerMask;

                const isArray = (spec & arrayMask) !== 0;
                const isReader = (spec & readerMask) !== 0;

                if (isReader) {
                    const reader = (types) ? types.get(dataType) : null;
                    if (reader) {
                        value = reader(
                            buffer,
                            start,
                            end,
                            DataFormat.Binary,
                            encoding
                        );
                    }
                } else {
                    const read = (t: DataType, start: number, end: number) => {
                        if (start === end) return null;

                        /* Cutoff for system object OIDs;
                           see comments in src/include/access/transam.h

                           We do not support user object OIDs.
                        */
                        if (t >= DataType.MinUserOid) return null;

                        switch (t) {
                            case DataType.Bool:
                                return (buffer[start] !== 0);
                            case DataType.Date: {
                                const n = buffer.readInt32BE(start);
                                if (n === 0x7fffffff) return infinity;
                                if (n === -0x80000000) return -infinity;

                                // Shift from 2000 to 1970 and fix units.
                                return new Date(
                                    (n * 1000 * 86400) + timeshift
                                );
                            }
                            case DataType.Timestamp:
                            case DataType.Timestamptz: {
                                const lo = buffer.readUInt32BE(start + 4);
                                const hi = buffer.readInt32BE(start);

                                if (lo === 0xffffffff &&
                                    hi === 0x7fffffff) return infinity;
                                if (lo === 0x00000000 &&
                                    hi === -0x80000000) return -infinity;

                                return new Date(
                                    (lo + hi * 4294967296) / 1000 +
                                    timeshift
                                );
                            }
                            case DataType.Int2:
                                return buffer.readInt16BE(start);
                            case DataType.Int4:
                            case DataType.Oid:
                                return buffer.readInt32BE(start);
                            case DataType.Int8:
                                return buffer.readBigInt64BE(start);
                            case DataType.Float4:
                                return buffer.readFloatBE(start);
                            case DataType.Float8:
                                return buffer.readDoubleBE(start);
                            case DataType.Bpchar:
                            case DataType.Char:
                            case DataType.Name:
                            case DataType.Text:
                            case DataType.Varchar:
                                return buffer.toString(encoding, start, end);
                            case DataType.Bytea:
                                const new_buffer = Buffer.allocUnsafe(end - start);
                                buffer.copy(new_buffer, 0, start, end);
                                return new_buffer;
                            case DataType.Jsonb:
                                if (buffer[start] === 1) {
                                    const jsonb = buffer.toString(
                                        encoding, start + 1, end
                                    );

                                    if (jsonb) {
                                        return JSON.parse(jsonb);
                                    }
                                }

                                break;
                            case DataType.Json:
                                const json = buffer.toString(encoding, start, end);
                                if (json) {
                                    return JSON.parse(json);
                                }
                                break;
                            case DataType.Point:
                                return {
                                    x: buffer.readDoubleBE(start),
                                    y: buffer.readDoubleBE(start + 8)
                                }
                            case DataType.Uuid:
                                return formatUuid(buffer.slice(start, end));
                        }
                        return null;
                    };

                    if (isArray) {
                        let offset = start;

                        const readArray = (size: number) => {
                            const array: ArrayValue<Primitive> =
                                new Array(size);

                            for (let j = 0; j < size; j++) {
                                const length = buffer.readInt32BE(offset);
                                offset += 4;
                                let value = null;
                                if (length >= 0) {
                                    const elementStart = offset;
                                    offset = elementStart + length;
                                    value = read(elementType, elementStart, offset);
                                }
                                array[j] = value;
                            }
                            return array;
                        }

                        const dimCount = buffer.readInt32BE(offset) - 1;
                        const elementType = buffer.readInt32BE(offset += 8);

                        offset += 4;

                        if (dimCount === 0) {
                            const size = buffer.readInt32BE(offset);
                            offset += 8;
                            value = readArray(size);
                        } else {
                            const arrays: ArrayValue<Primitive>[] =
                                new Array(dimCount);
                            const dims = new Uint32Array(dimCount);

                            for (let j = 0; j < dimCount; j++) {
                                const size = buffer.readInt32BE(offset);
                                dims[j] = size;
                                offset += 8;
                            }

                            const size = buffer.readInt32BE(offset);
                            const counts = Uint32Array.from(dims);
                            const total = dims.reduce((a, b) => a * b);

                            offset += 8;

                            for (let l = 0; l < total; l++) {
                                let next = readArray(size);
                                for (let j = dimCount - 1; j >= 0; j--) {
                                    const count = counts[j];
                                    const dim = dims[j];
                                    const k = dim - count;
                                    const m = count - 1;

                                    if (k === 0) {
                                        arrays[j] = new Array(dim);
                                    }

                                    const array = arrays[j];

                                    array[k] = next;
                                    counts[j] = m || dims[j];

                                    if (m !== 0) break;
                                    next = array;
                                }
                            }

                            value = arrays[0];
                        }
                    } else {
                        value = read(dataType, start, end);
                    }
                }
            }
        }

        row[j] = value;
        offset = end;
    }

    return offset;
}

export function writeMessage(
    code: number | null,
    segments: Segment[]) {
    const size = getMessageSize(code, segments);
    const buffer = Buffer.allocUnsafe(size);
    writeMessageInto(code, segments, buffer);
    return buffer;
}

function writeMessageInto(
    code: number | null,
    segments: Segment[],
    buffer: Buffer) {
    let offset = 0;
    if (code) buffer[offset++] = code;
    buffer.writeInt32BE(buffer.length - (code ? 1 : 0), offset);
    offset += 4;
    const length = segments.length;
    for (let i = 0; i < length; i++) {
        const [segment, value] = segments[i];
        switch (segment) {
            case SegmentType.Buffer: {
                if (value instanceof Buffer) {
                    value.copy(buffer, offset);
                    offset += value.length;
                }
                break;
            }
            case SegmentType.Float4: {
                const n = Number(value);
                buffer.writeFloatBE(n, offset);
                offset += 4;
                break;
            }
            case SegmentType.Float8: {
                const n = Number(value);
                buffer.writeDoubleBE(n, offset);
                offset += 8;
                break;
            }
            case SegmentType.Int8: {
                const n = Number(value);
                buffer.writeInt8(n, offset);
                offset += 1;
                break;
            }
            case SegmentType.Int16BE: {
                const n = Number(value);
                buffer.writeInt16BE(n, offset);
                offset += 2;
                break;
            }
            case SegmentType.Int32BE: {
                const n = Number(value);
                buffer.writeInt32BE(n, offset);
                offset += 4;
                break;
            }
            case SegmentType.Int64BE: {
                const n = value instanceof Buffer ? value.readBigInt64BE(0) : (
                    typeof value === "bigint" ? value : BigInt(Number(value))
                );
                buffer.writeBigInt64BE(n, offset);
                offset += 8;
                break;
            }
            case SegmentType.UInt32BE: {
                const n = Number(value);
                buffer.writeUInt32BE(n, offset);
                offset += 4;
                break;
            }
        }
    }
}

export class Reader {
    constructor(private readonly buffer: Buffer, private offset: number) { }

    readInt32BE() {
        const n = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return n;
    }

    readCString(encoding: BufferEncoding) {
        const offset = this.offset;
        const i = this.buffer.indexOf(0, offset);
        const s = this.buffer.toString(encoding, offset, i);
        this.offset = i + 1;
        return s;
    }
}

export class Writer {
    private outgoing: ElasticBuffer = new ElasticBuffer(4096);

    constructor(private readonly encoding: BufferEncoding) { }

    bind(
        name: string,
        portal: string,
        format: DataFormat | DataFormat[] = DataFormat.Binary,
        values: Value[] = [],
        types: DataType[] = []) {
        // We silently ignore any mismatch here, assuming that the
        // query will fail and make the error evident.
        const length = Math.min(types.length, values.length);

        const segments: Segment[] = [
            makeBufferSegment(portal, this.encoding, true),
            makeBufferSegment(name, this.encoding, true),
            [SegmentType.Int16BE, length]
        ];

        const getFormat =
            (typeof format === 'number') ?
                () => format :
                (i: number) => format[i];

        for (let i = 0; i < length; i++) {
            segments.push([SegmentType.Int16BE, getFormat(i)]);
        }

        segments.push([SegmentType.Int16BE, length]);

        const add = (message: SegmentType, value: SegmentValue) => {
            segments.push([message, value]);
            return getSegmentSize(message, value);
        }

        const reserve = (message: SegmentType) => {
            const segment: Segment = [message, null];
            segments.push(segment);
            return (value: SegmentValue) => {
                segment[1] = value;
            }
        };

        const addBinaryValue = (value: Value, dataType: DataType): number => {
            let size = -1;
            const setSize = reserve(SegmentType.Int32BE);

            if (value === null) {
                setSize(-1);
                return 0;
            }

            switch (dataType) {
                case DataType.Bool: {
                    size = add(SegmentType.Int8, (value) ? 1 : 0);
                    break;
                }
                case DataType.Date: {
                    if (value === infinity) {
                        size = add(SegmentType.Int32BE, 0x7fffffff);
                    } else if (value === -infinity) {
                        size = add(SegmentType.Int32BE, -0x80000000);
                    } else if (value instanceof Date) {
                        size = add(
                            SegmentType.Int32BE,
                            (value.getTime() - timeshift) /
                            (1000 * 86400));
                    }
                    break;
                }
                case DataType.Timestamp:
                case DataType.Timestamptz: {
                    if (value === infinity) {
                        size = sum(
                            add(SegmentType.UInt32BE, 0x7fffffff),
                            add(SegmentType.UInt32BE, 0xffffffff)
                        );
                    } else if (value === -infinity) {
                        size = sum(
                            add(SegmentType.UInt32BE, 0x80000000),
                            add(SegmentType.UInt32BE, 0x00000000)
                        );
                    } else if (value instanceof Date) {
                        const n = (value.getTime() - timeshift) * 1000;
                        const f = Math.floor(n / 4294967296);
                        const r = n - f * 4294967296;
                        size = sum(
                            add(SegmentType.Int32BE, f),
                            add(SegmentType.UInt32BE, r)
                        );
                    }
                    break;
                }
                case DataType.Bpchar:
                case DataType.Bytea:
                case DataType.Char:
                case DataType.Name:
                case DataType.Text:
                case DataType.Varchar: {
                    if (value instanceof Buffer) {
                        size = add(SegmentType.Buffer, value);
                    } else {
                        const s = String(value);
                        size = add(
                            SegmentType.Buffer,
                            makeBuffer(s, this.encoding)
                        );
                    }
                    break;
                }
                case DataType.Float4: {
                    size = add(SegmentType.Float4, Number(value));
                    break;
                }
                case DataType.Float8: {
                    size = add(SegmentType.Float8, Number(value));
                    break;
                }
                case DataType.Int2: {
                    size = add(SegmentType.Int16BE, Number(value));
                    break;
                }
                case DataType.Int4:
                case DataType.Oid: {
                    size = add(SegmentType.Int32BE, Number(value));
                    break;
                }
                case DataType.Int8: {
                    size = add(
                        SegmentType.Int64BE,
                        value instanceof Buffer ? value.readBigInt64BE(0) : (
                            typeof value === "bigint" ? value : Number(value)
                        )
                    );
                    break;
                }
                case DataType.Point: {
                    if (isPoint(value)) {
                        size = sum(
                            add(SegmentType.Float8, value.x),
                            add(SegmentType.Float8, value.y)
                        );
                    }
                    break;
                }
                case DataType.Jsonb:
                    const body = JSON.stringify(value);
                    add(SegmentType.Int8, 0x01);
                    size = 1 + add(
                        SegmentType.Buffer,
                        makeBuffer(body, this.encoding)
                    );
                    break;
                case DataType.Json: {
                    const body = JSON.stringify(value);
                    size = add(
                        SegmentType.Buffer,
                        makeBuffer(body, this.encoding)
                    );
                    break;
                }
                case DataType.Uuid: {
                    try {
                        if (typeof value === 'string') {
                            const buffer = parseUuid(value);
                            size = add(SegmentType.Buffer, buffer);
                        }
                    } catch (error) {
                        throw new Error(
                            `Invalid UUID: ${value} (${error})`
                        );
                    }
                    break;
                }
                default: {
                    const innerDataType = arrayDataTypeMapping.get(dataType);
                    if (innerDataType && value instanceof Array) {
                        size = addBinaryArray(value, innerDataType);
                    } else {
                        throw new Error(`Unsupported data type: ${dataType}`);
                    }
                }
            }

            setSize(size);
            return size;
        };

        const addBinaryArray = (
            value: Value[],
            dataType: DataType): number => {
            const setDimCount = reserve(SegmentType.Int32BE);
            add(SegmentType.Int32BE, 1);
            add(SegmentType.Int32BE, dataType);

            let bytes = 12;
            let dimCount = 0;

            const go = (level: number, value: Value[]) => {
                const length = value.length;
                if (length === 0) return;

                if (level === dimCount) {
                    bytes += sum(
                        add(SegmentType.Int32BE, length),
                        add(SegmentType.Int32BE, 1)
                    );
                    dimCount++;
                }

                for (let i = 0; i < length; i++) {
                    const v = value[i];
                    if (v instanceof Array) {
                        go(level + 1, v);
                    } else {
                        bytes += addBinaryValue(v, dataType) + 4;
                    }
                }

            };

            go(0, value);
            setDimCount(dimCount);
            return bytes;
        }

        const getTextFromValue = (
            value: Value,
            dataType: DataType): null | string | string[] => {
            if (value === null) return null;

            switch (dataType) {
                case DataType.Bool:
                    return value ? 't' : 'f';
                case DataType.Int2:
                case DataType.Int4:
                case DataType.Int8:
                case DataType.Oid:
                case DataType.Float4:
                case DataType.Float8:
                    if (typeof value === 'number') {
                        return value.toString();
                    }
                    break;
                case DataType.Bpchar:
                case DataType.Bytea:
                case DataType.Char:
                case DataType.Name:
                case DataType.Text:
                case DataType.Varchar:
                    return (typeof value === 'string') ?
                        value :
                        (value instanceof Buffer) ?
                            value.toString(this.encoding) :
                            value.toString();
                case DataType.Date:
                    return (value instanceof Date) ?
                        dateToStringUTC(value, false) :
                        value.toString();
                case DataType.Timestamp:
                case DataType.Timestamptz:
                    return (value instanceof Date) ?
                        dateToStringUTC(value, true) :
                        value.toString();
                case DataType.Jsonb:
                case DataType.Json:
                    return JSON.stringify(value);
                default: {
                    const innerDataType = arrayDataTypeMapping.get(dataType);
                    if (innerDataType) {
                        if (value instanceof Array) {
                            return getTextFromArray(value, innerDataType);
                        }
                    }
                    throw new Error(`Unsupported data type: ${dataType}`);
                }
            }

            return null;
        }

        const getTextFromArray = (
            value: Value[],
            dataType: DataType): string[] => {
            const strings: string[] = [];
            strings.push('{');
            const escape = (s: string) => {
                return s
                    .replace(/\\/gu, '\\\\')
                    .replace(/"/gu, '\\"')
                    .replace(/,/gu, '\\,');
            };
            for (let i = 0; i < value.length; i++) {
                if (i > 0) strings.push(',');
                const child = value[i];
                const result =
                    (child instanceof Array) ?
                        getTextFromArray(child, dataType) :
                        getTextFromValue(child, dataType);
                if (result instanceof Array) {
                    strings.push(...result);
                } else {
                    strings.push((result === null) ? 'null' : escape(result));
                }
            }
            strings.push('}');
            return strings;
        }

        for (let i = 0; i < length; i++) {
            const value = values[i];
            const dataType = types[i];
            const format = getFormat(i);
            if (format === DataFormat.Binary) {
                addBinaryValue(value, dataType);
            } else {
                const result = getTextFromValue(value, dataType);
                const setSize = reserve(SegmentType.Int32BE);
                const size =
                    (result instanceof Array) ?
                        sum(...result.map(
                            (s: string) =>
                                add(SegmentType.Buffer,
                                    makeBuffer(s, this.encoding)))) :
                        add(SegmentType.Buffer,
                            (result === null) ?
                                nullBuffer :
                                makeBuffer(result, this.encoding)
                        );
                setSize(size);
            }
        }

        add(SegmentType.Int16BE, 1);
        add(SegmentType.Int16BE, 1);

        this.enqueue(Command.Bind, segments);
    }

    close(name: string, kind: 'S' | 'P') {
        this.enqueue(
            Command.Close, [
            makeBufferSegment(kind + name, this.encoding, true)
        ]);
    }

    describe(name: string, kind: 'S' | 'P') {
        this.enqueue(
            Command.Describe, [
            makeBufferSegment(kind + name, this.encoding, true)
        ]);
    }

    execute(portal: string, limit = 0) {
        this.enqueue(
            Command.Execute, [
            makeBufferSegment(portal, this.encoding, true),
            [SegmentType.Int32BE, limit],
        ]);
    }

    end() {
        this.enqueue(Command.End, []);
    }

    flush() {
        this.enqueue(Command.Flush, []);
    }

    parse(
        name: string,
        text: string,
        types: DataType[] = []) {
        const length = types.length;
        const segments: Segment[] = [
            makeBufferSegment(name, this.encoding, true),
            makeBufferSegment(text, this.encoding, true),
            [SegmentType.Int16BE, length]
        ];
        for (let i = 0; i < length; i++) {
            segments.push([SegmentType.Int32BE, types[i]]);
        }
        this.enqueue(Command.Parse, segments);
    }

    password(text: string) {
        this.enqueue(
            Command.Password,
            [makeBufferSegment(text, this.encoding, true)],
        );
    }

    saslInitialResponse(mechanism: string, clientNonce: string) {
        if (mechanism !== 'SCRAM-SHA-256') return false;
        const response = Buffer.from('n,,n=*,r=' + clientNonce);
        this.enqueue(
            Command.SASLResponse, [
            makeBufferSegment(mechanism, this.encoding, true),
            [SegmentType.Int32BE, response.length],
            [SegmentType.Buffer, response]
        ]);
        return true;
    }

    saslResponse(data: string, password: string, clientNonce: string) {
        const m = Object.fromEntries(data.split(',').map(
            (attr) => [attr[0], attr.substring(2)])
        );

        if (!(m.i && m.r && m.s)) throw new Error("SASL message parse error");

        const nonce = m.r;

        if (!nonce.startsWith(clientNonce))
            throw new Error("SASL nonce mismatch");
        if (nonce.length === clientNonce.length)
            throw new Error("SASL nonce too short");

        const iterations = parseInt(m.i, 10);
        const salt = Buffer.from(m.s, 'base64');
        const saltedPassword = hi(password, salt, iterations)

        const clientKey = hmacSha256(saltedPassword, 'Client Key');
        const storedKey = sha256(clientKey);

        const clientFinalMessageWithoutProof = 'c=biws,r=' + nonce;
        const clientFirstMessageBare = 'n=*,r=' + clientNonce;
        const serverFirstMessage = data;

        const authMessage = (
            clientFirstMessageBare + ',' +
            serverFirstMessage + ',' +
            clientFinalMessageWithoutProof
        );

        const clientSignature = hmacSha256(storedKey, authMessage);
        const clientProofBytes = xorBuffers(clientKey, clientSignature);
        const clientProof = clientProofBytes.toString('base64');

        const serverKey = hmacSha256(saltedPassword, 'Server Key');
        const serverSignatureBytes = hmacSha256(serverKey, authMessage);

        const response = clientFinalMessageWithoutProof + ',p=' + clientProof;
        const serverSignature = serverSignatureBytes.toString('base64');

        this.enqueue(
            Command.SASLResponse, [
            makeBufferSegment(response, this.encoding, false)
        ]);

        return serverSignature;
    }

    saslFinal(data: string, serverSignature: string) {
        if (!data.split(',').find((attr) => {
            if (attr[0] === 'v') {
                return (attr.substr(2) === serverSignature);
            }
            return false;
        })) throw new Error('SASL server signature does not match');
    }

    send(socket: Socket) {
        if (this.outgoing.empty) return false;
        const buffer = this.outgoing.consume();
        return socket.write(buffer);
    }

    startup(config: StartupConfiguration) {
        const data = [
            'user',
            config.user,
            'database',
            config.database,
            'extra_float_digits',
            String(config.extraFloatDigits),
            'client_encoding',
            this.encoding,
            ''
        ];

        const segments: Segment[] = [
            [SegmentType.Int16BE, 3],
            [SegmentType.Int16BE, 0]
        ];

        for (const s of data) {
            segments.push(makeBufferSegment(s, this.encoding, true));
        }

        this.enqueue(null, segments);
    }

    startupSSL() {
        const segments: Segment[] = [
            [SegmentType.Int16BE, 0x04D2],
            [SegmentType.Int16BE, 0x162F]
        ];
        this.enqueue(null, segments);
    }

    sync() {
        this.enqueue(Command.Sync, []);
    }

    private enqueue(
        code: number | null,
        segments: Segment[]) {
        const size = getMessageSize(code, segments);

        // Allocate space and write segments.
        const buffer = this.outgoing.getBuffer(size);
        writeMessageInto(code, segments, buffer);
    }
}

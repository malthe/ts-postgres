import { Socket } from 'net';
import { ElasticBuffer } from './buffer';
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
import * as logger from './logging';

const arrayMask = 1 << 31;
const readerMask = 1 << 29;
const infinity = Number('Infinity');
const timeshift = 946684800000;

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
    Sync = 0x53
}

export enum ErrorLevel {
    error = 'ERROR',
    fatal = 'FATAL',
    panic = 'PANIC'
}

export const enum Message {
    Authenticate = 0x52,
    BackendKeyData = 0x4b,
    BindComplete = 0x32,
    CloseComplete = 0x33,
    CommandComplete = 0x43,
    EmptyQueryResponse = 0x49,
    Error = 0x45,
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

export const enum TransactionStatus {
    Idle = 0x49,
    InTransaction = 0x54,
    InError = 0x45
}

export type SegmentValue = Buffer | number | null | string;
export type Segment = [SegmentType, SegmentValue];

export const enum SegmentType {
    Buffer,
    CString,
    Float4,
    Float8,
    Int8,
    Int16BE,
    Int32BE,
    String,
    UInt32BE
};

export interface RowDescription {
    columns: Uint32Array;
    names: string[]
}

export function getMessageSize(
    segment: SegmentType,
    value: SegmentValue,
    encoding: string) {
    switch (segment) {
        case SegmentType.Buffer: {
            if (value instanceof Buffer) {
                return value.length;
            } else {
                break;
            }
        }
        case SegmentType.CString: {
            const s = String(value);
            return Buffer.byteLength(s, encoding) + 1;
        }
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
        case SegmentType.String: {
            if (typeof value === 'string') {
                return Buffer.byteLength(value, encoding);
            } else {
                break;
            }
        }
    }
    return -1;
}

export function readRowDescription(
    buffer: Buffer,
    start: number,
    types?: ReadonlyMap<DataType, ValueTypeReader>) {
    let offset = start;
    let length = buffer.readInt16BE(offset);
    let columns = new Uint32Array(length);
    let names = new Array<string>(length);
    offset += 2;
    let i = 0;

    while (i < length) {
        const j = buffer.indexOf('\0', offset);
        const name = buffer.slice(offset, j).toString();
        const dataType = buffer.readInt32BE(j + 7);
        const format = buffer.readInt16BE(j + 17);
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
    rowDataOffset: number,
    rowDescription: RowDescription,
    encoding: string,
    types: ReadonlyMap<DataType, ValueTypeReader> | null):
    ArrayValue<Primitive> {
    const columns = buffer.readInt16BE(rowDataOffset);
    const row = new Array<Value>(columns);
    const columnSpecification = rowDescription.columns;
    const columnNames = rowDescription.names;

    let dataColumnOffset = rowDataOffset + 2;
    let i = 0;

    while (i < columns) {
        const length = buffer.readInt32BE(dataColumnOffset);
        const start = dataColumnOffset + 4;
        const end = start + length;

        dataColumnOffset = end;

        const spec = columnSpecification[i];
        const dataType: DataType =
            spec &
            ~arrayMask &
            ~readerMask;

        const isArray = (spec & arrayMask) !== 0;
        const isReader = (spec & readerMask) !== 0;

        let value: Value = null;

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
                    };
                    case DataType.Int2:
                        return buffer.readInt16BE(start);
                    case DataType.Int4:
                    case DataType.Oid:
                        return buffer.readInt32BE(start);
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
                        return buffer.slice(start, end);
                    case DataType.Json:
                        return JSON.parse(buffer.toString(
                            encoding, start, end));
                    case DataType.Point:
                        return {
                            x: buffer.readDoubleBE(start),
                            y: buffer.readDoubleBE(start + 8)
                        }
                };
                return null;
            };

            if (isArray) {
                let offset = start;
                const dimCount = buffer.readInt32BE(offset) - 1;
                const flags = buffer.readInt32BE(offset += 4);
                const elementType = buffer.readInt32BE(offset += 4);

                offset += 4;

                if (dimCount === 0) {
                    const size = buffer.readInt32BE(offset);
                    const array: ArrayValue<Primitive> = new Array(size);
                    offset += 8;
                    for (let j = 0; j < size; j++) {
                        const length = buffer.readInt32BE(offset);
                        const elementStart = offset + 4;
                        const elementEnd = elementStart + length;
                        offset = elementEnd;
                        array[j] = read(
                            elementType,
                            elementStart,
                            elementEnd
                        );
                    }
                    value = array;
                } else {
                    const arrays: ArrayValue<Primitive>[] =
                        new Array(dimCount);
                    const dims = new Uint32Array(dimCount);

                    for (let j = 0; j < dimCount; j++) {
                        const size = buffer.readInt32BE(offset);;
                        dims[j] = size;
                        offset += 8;
                    }

                    const size = buffer.readInt32BE(offset);
                    const counts = Uint32Array.from(dims);
                    const total = dims.reduce((a, b) => a * b);

                    offset += 8;

                    for (let l = 0; l < total; l++) {
                        const array: ArrayValue<Primitive> =
                            new Array(size);

                        for (let j = 0; j < size; j++) {
                            const length = buffer.readInt32BE(offset);
                            const elementStart = offset + 4;
                            const elementEnd = elementStart + length;
                            offset = elementEnd;
                            array[j] = read(
                                elementType,
                                elementStart,
                                elementEnd
                            );
                        }

                        let next = array;
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

        row[i] = value;
        i++;
    }

    return row;
}

export class Reader {
    constructor(private readonly buffer: Buffer, private offset: number) { }

    readInt32BE() {
        const n = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return n;
    }

    readCString(encoding: string) {
        const offset = this.offset;
        const i = this.buffer.indexOf(0, offset);
        const s = this.buffer.toString(encoding, offset, i);
        this.offset = i + 1;
        return s;
    }
}

export class Writer {
    private outgoing: ElasticBuffer = new ElasticBuffer(4096);
    constructor(
        private readonly stream: Socket,
        private readonly encoding: string,
        private readonly suppressDataTypeNotSupportedWarning: boolean) { }

    bind(
        name: string,
        portal: string,
        values: Value[] = [],
        types: DataType[] = []) {
        // We silently ignore any mismatch here, assuming that the
        // query will fail and make the error evident.
        const length = Math.min(types.length, values.length);

        let segments: Segment[] = [
            [SegmentType.CString, portal],
            [SegmentType.CString, name],
            [SegmentType.Int16BE, length]
        ];

        for (let i = 0; i < length; i++) {
            segments.push([SegmentType.Int16BE, 1]);
        }

        segments.push([SegmentType.Int16BE, length]);

        const add = (message: SegmentType, value: SegmentValue) => {
            segments.push([message, value]);
            return getMessageSize(message, value, this.encoding);
        }

        const addSize = (size: number) =>
            add(SegmentType.Int32BE, size);

        const reserve = (message: SegmentType) => {
            let segment: Segment = [message, null];
            segments.push(segment);
            return (value: SegmentValue) => {
                segment[1] = value;
            }
        };

        const addValue = (value: Value, dataType: DataType): number => {
            let size = -1;
            let setSize = reserve(SegmentType.Int32BE);

            switch (dataType) {
                case DataType.Bool: {
                    size = add(SegmentType.Int8, (value) ? 1 : 0);
                    break;
                };
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
                };
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
                };
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
                        size = add(SegmentType.String, s);
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
                case DataType.Point: {
                    if (isPoint(value)) {
                        size = sum(
                            add(SegmentType.Float8, value.x),
                            add(SegmentType.Float8, value.y)
                        );
                    };
                    break;
                };
                case DataType.Json: {
                    const body = JSON.stringify(value);
                    size = add(SegmentType.String, body);
                    break;
                };
                default: {
                    const innerDataType = arrayDataTypeMapping.get(dataType);
                    if (innerDataType) {
                        if (value instanceof Array) {
                            size = addArray(value, innerDataType);
                        } else {
                            throw {
                                dataType: dataType,
                                value: value
                            };
                        }
                    } else {
                        if (!this.suppressDataTypeNotSupportedWarning) {
                            logger.warn(
                                'Data type not supported: ' +
                                dataType
                            );
                        }
                    }
                }
            }

            setSize(size);
            return size;
        };

        const addArray = (value: Value[], dataType: DataType): number => {
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
                        bytes += addValue(v, dataType) + 4;
                    }
                }

            };

            go(0, value);
            setDimCount(dimCount);
            return bytes;
        }

        for (let i = 0; i < length; i++) {
            const value = values[i];
            const dataType = types[i];
            addValue(value, dataType);
        }

        add(SegmentType.Int16BE, 1);
        add(SegmentType.Int16BE, 1);

        this.enqueue(Command.Bind, segments);
    }

    close(name: string, kind: 'S' | 'P') {
        this.enqueue(
            Command.Close, [
                [SegmentType.CString, kind + name]
            ]);
    }

    describe(name: string, kind: 'S' | 'P') {
        this.enqueue(
            Command.Describe, [
                [SegmentType.CString, kind + name]
            ]);
    }

    end() {
        this.enqueue(Command.End, []);
    }

    execute(portal: string, limit = 0) {
        this.enqueue(
            Command.Execute, [
                [SegmentType.CString, portal],
                [SegmentType.Int32BE, limit],
            ]);
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
            [SegmentType.CString, name],
            [SegmentType.CString, text],
            [SegmentType.Int16BE, length]
        ];
        for (let i = 0; i < length; i++) {
            segments.push([SegmentType.Int32BE, types[i]]);
        }
        this.enqueue(Command.Parse, segments);
    };

    password(text: string) {
        this.enqueue(
            Command.Password, [
                [SegmentType.CString, text]
            ]);
    }

    send() {
        if (this.outgoing.isEmpty()) return false;

        const buffer = this.outgoing.slice();
        this.outgoing.clear();

        return !this.stream.write(buffer);
    }

    startup(user: string, database: string, extraFloatDigits: number) {
        const data = [
            'user',
            user,
            'database',
            database,
            'extra_float_digits',
            String(extraFloatDigits),
            'client_encoding',
            this.encoding,
            ''
        ];

        const segments: Segment[] = [
            [SegmentType.Int16BE, 3],
            [SegmentType.Int16BE, 0]
        ];

        for (let s of data) {
            segments.push([SegmentType.CString, s]);
        }

        this.enqueue(null, segments, true);
    }

    sync() {
        this.enqueue(Command.Sync, []);
    }

    private getMessageSize(code: number | null, segments: Segment[]) {
        // Messages are composed of a one byte message code plus a
        // 32-bit message length.
        let size = 4 + (code ? 1 : 0);

        // Precompute total message size.
        const length = segments.length;
        for (let i = 0; i < length; i++) {
            const [segment, value] = segments[i];
            size += getMessageSize(segment, value, this.encoding);
        };

        return size;
    };


    private encodedStringLength(value: string) {
        return Buffer.byteLength(value, this.encoding);
    }

    private enqueue(
        code: number | null,
        segments: Segment[],
        writeImmediately = false) {
        // Allocate space and write segments.
        const size = this.getMessageSize(code, segments);
        const buffer =
            (writeImmediately) ?
                Buffer.allocUnsafe(size) :
                this.outgoing.getBuffer(size);

        this.write(code, segments, buffer, size);
        if (writeImmediately) this.stream.write(buffer);
    }

    private write(
        code: number | null,
        segments: Segment[],
        buffer: Buffer,
        size: number) {
        let offset = 0;
        if (code) buffer[offset++] = code;
        buffer.writeInt32BE(size - (code ? 1 : 0), offset);
        offset += 4;
        const length = segments.length;
        for (let i = 0; i < length; i++) {
            const [segment, value] = segments[i];
            switch (segment) {
                case SegmentType.Buffer: {
                    const b = (value instanceof Buffer) ?
                        value : Buffer.from(String(value), this.encoding);
                    b.copy(buffer, offset);
                    offset += b.length;
                    break;
                }
                case SegmentType.CString: {
                    const s = String(value);
                    const length = this.encodedStringLength(s);
                    buffer.write(s, offset, length, this.encoding);
                    offset += length + 1;
                    buffer[offset - 1] = 0;
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
                };
                case SegmentType.String: {
                    const s = String(value);
                    const length = this.encodedStringLength(s);
                    buffer.write(s, offset, length, this.encoding);
                    offset += length;
                    break;
                }
                case SegmentType.UInt32BE: {
                    const n = Number(value);
                    buffer.writeUInt32BE(n, offset);
                    offset += 4;
                    break;
                };
            }
        }
    }
}


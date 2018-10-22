import { ECONNRESET } from 'constants';
import { Socket } from 'net';
import { Event as TypedEvent, events } from 'ts-typed-events';

import * as defaults from './defaults';
import * as logger from './logging';

import { ElasticBuffer } from './buffer';
import { postgresqlErrorCodes } from './errors';
import { Queue } from './queue';
import { Query } from './query';

import {
    DataHandler,
    NameHandler,
    ResultIterator,
    makeResult
} from './result';

import {
    readRowData,
    readRowDescription,
    ErrorLevel,
    Message,
    Reader,
    RowDescription,
    TransactionStatus,
    Writer
} from './protocol';

import {
    DataType,
    Row,
    Value,
    ValueTypeReader
} from './types';

export interface Connect { };

export interface End { };

export interface Parameter {
    name: string;
    value: string;
};

export interface DatabaseError {
    level: ErrorLevel,
    code: keyof typeof postgresqlErrorCodes,
    message: string
};

export interface ClientNotice extends DatabaseError {
    level: ErrorLevel,
    code: keyof typeof postgresqlErrorCodes,
    message: string
};

export interface DataTypeError {
    dataType: DataType,
    value: Value
}

export interface Configuration {
    host?: string,
    port?: number,
    user?: string,
    database?: string,
    password?: string,
    types?: Map<DataType, ValueTypeReader>,
    suppressDataTypeNotSupportedWarning?: boolean,
    extraFloatDigits?: number,
    preparedStatementPrefix?: string
}

export interface Notification {
    processId: number,
    channel: string,
    payload?: string
}

type Callback<T> = (data: T) => void;

type EventCallback = (
    Callback<ClientNotice> |
    Callback<Connect> |
    Callback<DatabaseError> |
    Callback<End> |
    Callback<Parameter> |
    Callback<Notification>
);

type RowDataHandler = DataHandler<Row>;

interface SystemError extends Error {
    errno: string | number
}

interface PreparedStatement {
    name: string;
    portal: string;
    values: Value[];
}

interface RowDataHandlerInfo {
    readonly handler: RowDataHandler;
    readonly description: RowDescription;
}

export class Client {
    keepAlive = true;

    private readonly events = events({
        connect: new TypedEvent<Connect>(),
        end: new TypedEvent<End>(),
        parameter: new TypedEvent<Parameter>(),
        error: new TypedEvent<DatabaseError>(),
        notice: new TypedEvent<ClientNotice>(),
        notification: new TypedEvent<Notification>()
    });

    private ending = false;
    private connected = false;
    private connecting = false;
    private readonly encoding = 'utf-8';
    private readonly stream = new Socket();
    private readonly writer: Writer;
    private buffer: Buffer | null = null;
    private expect = 5;
    private offset = 0;
    private closed = false;
    private remaining = 0;
    private dataHandlers = new Queue<RowDataHandler>();
    private nameHandlers = new Queue<NameHandler>();
    private rowDescriptions = new Queue<RowDescription>();
    private preparedStatements = new Queue<PreparedStatement>();
    private nextPreparedStatementId = 0;
    private activeDataHandlerInfo: RowDataHandlerInfo | null = null;
    private ready = false;
    private mustDrain = false;

    public processId: number | null = null;
    public secretKey: number | null = null;
    public transactionStatus: TransactionStatus | null = null;

    constructor(public readonly config: Configuration = {}) {
        this.writer = new Writer(
            this.stream,
            this.encoding,
            config.suppressDataTypeNotSupportedWarning || false
        );

        this.stream.on('connect', () => {
            if (this.keepAlive) {
                this.stream.setKeepAlive(true)
            };
            this.closed = false;
            this.writer.startup(
                this.config.user || defaults.user || '',
                this.config.database || defaults.database || '',
                this.config.extraFloatDigits || 0
            );
        });

        this.stream.on('close', () => {
            this.ready = false;
            this.connected = false;
        });

        this.stream.on('drain', () => {
            this.mustDrain = false;
            this.flush();
        });

        this.stream.on('data', (buffer: Buffer) => {
            const length = buffer.length;
            const remaining = this.remaining;
            const size = length + remaining;

            if (this.buffer && remaining) {
                const free = this.buffer.length - this.offset - remaining;
                let tail = this.offset + remaining;
                if (free < length) {
                    const newBuffer = Buffer.allocUnsafe(size);
                    this.buffer.copy(newBuffer, 0, this.offset, tail);
                    this.offset = 0;
                    this.buffer = newBuffer;
                    tail = remaining;
                };
                buffer.copy(this.buffer, tail, 0, length);
            } else {
                this.buffer = buffer;
                this.offset = 0;
            }

            const read = this.receive(this.buffer, this.offset, size);
            this.offset += read;
            this.remaining = size - read;
        });

        this.stream.on('error', (error: SystemError) => {
            // Don't raise ECONNRESET errors - they can & should be
            // ignored during disconnect
            if (this.ending && error.errno === ECONNRESET) {
                return
            }
            this.events.end.emit({});
        });

        this.stream.on('finish', () => {
            this.closed = true;
            this.events.end.emit({});
        });
    }

    connect() {
        if (this.connecting) {
            throw new Error('Already connecting');
        }

        this.connecting = true;

        let p = this.events.connect.once();
        const port = this.config.port || defaults.port;
        const host = this.config.host || defaults.host;

        if (host.indexOf('/') === 0) {
            this.stream.connect(host + '/.s.PGSQL.' + port);
        } else {
            this.stream.connect(port, host);
        }

        return p;
    }

    end() {
        if (this.closed) {
            throw new Error('Connection already closed.');
        }
        this.ending = true;
        this.writer.end();
        this.flush();
        return this.events.end.once();
    }

    on(event: 'connect', callback: Callback<Connect>): void;
    on(event: 'end', callback: Callback<End>): void;
    on(event: 'parameter', callback: Callback<Parameter>): void;
    on(event: 'notification', callback: Callback<Notification>): void;
    on(event: 'error', callback: Callback<DatabaseError>): void;
    on(event: 'notice', callback: Callback<ClientNotice>): void;
    on(event: string, callback: EventCallback): void {
        switch (event) {
            case 'connect': {
                this.events.connect.on(
                    callback as Callback<Connect>);
                break;
            }
            case 'end': {
                this.events.end.on(
                    callback as Callback<End>);
                break;
            }
            case 'error': {
                this.events.error.on(
                    callback as Callback<DatabaseError>);
                break;
            }
            case 'notice': {
                this.events.notice.on(
                    callback as Callback<ClientNotice>);
                break
            }
            case 'notification': {
                this.events.notification.on(
                    callback as Callback<Notification>);
                break
            }
            case 'parameter': {
                this.events.parameter.on(
                    callback as Callback<Parameter>);
                break
            }
        }
    }

    query(query: Query): ResultIterator<Value>;
    query(text: string, args?: Value[], types?: DataType[]):
        ResultIterator<Value>;
    query(text: string | Query, args?: Value[], types?: DataType[]):
        ResultIterator<Value> {
        const query =
            (typeof text === 'string') ?
                new Query(text, args || [], types || []) :
                text;
        return this.execute(query);
    }

    private encodedStringLength(value: string) {
        return Buffer.byteLength(value, this.encoding);
    }

    private execute(query: Query): ResultIterator<Value> {
        const text = query.text;
        const values = query.values;
        const types = query.types;
        const portal = query.portal || '';

        if (values && values.length) {
            const name = query.name || (
                (this.config.preparedStatementPrefix ||
                    defaults.preparedStatementPrefix) + (
                    this.nextPreparedStatementId++
                ));
            this.writer.parse(name, text, types || []);
            this.writer.describe(name, 'S');
            this.writer.sync();
            this.preparedStatements.push({
                name: name,
                portal: portal,
                values: values
            });
        } else {
            const name = query.name || '';
            this.writer.parse(name, text);
            this.writer.bind(name, portal);
            this.writer.describe(portal, 'P');
            this.writer.execute(portal);
            this.writer.close(name, 'S');
            if (portal) {
                this.writer.close(portal, 'P');
            }
            this.writer.sync();
        }

        const result = makeResult<Value>(
            (handler) => { this.dataHandlers.push(handler) },
            (handler) => { this.nameHandlers.push(handler) }
        );

        this.flush();
        return result
    }

    private flush() {
        if (!this.ready || this.mustDrain) return;
        if (this.writer.send()) this.mustDrain = true;
    }

    private parseError(buffer: Buffer) {
        let level: DatabaseError['level'] | null = null;
        let code: DatabaseError['code'] | null = null;
        let message: DatabaseError['message'] | null = null;

        const length = buffer.length;
        let offset = 0;

        while (offset < length) {
            let next = buffer.indexOf(0, offset);
            if (next < 0) break;

            const value = buffer.slice(offset + 1, next).toString();

            switch (buffer[offset]) {
                case 0x56: {
                    level = value as DatabaseError['level'];
                    break;
                }
                case 0x43: {
                    code = value as DatabaseError['code'];
                    break;
                }
                case 0x4d: {
                    message = value;
                    break;
                }
                default:
                    break;
            };

            offset = next + 1;
        }

        if (level && code && message) {
            return {
                level: level,
                code: code,
                message: message
            };
        }

        throw new Error('Unable to parse error message.');
    }

    private receive(buffer: Buffer, offset: number, size: number): number {
        const types = this.config.types || null;
        let read = 0;

        while (size >= this.expect + read) {
            let frame = offset + read;
            let mtype;

            // Fast path: retrieve data rows.
            let info = this.activeDataHandlerInfo;
            while (true) {
                mtype = buffer.readInt8(frame);
                if (mtype !== Message.RowData) break;

                if (!info) {
                    const handler = this.dataHandlers.shift();
                    if (!handler) {
                        throw new Error('Unexpected data received.');
                    }

                    const description = this.rowDescriptions.shift();
                    if (description) {
                        info = {
                            handler: handler,
                            description: description
                        }
                        this.activeDataHandlerInfo = info;
                    } else {
                        throw new Error('Row description expected.');
                    }
                }

                const bytes = buffer.readInt32BE(frame + 1) + 1;

                if (info) {
                    const total = bytes + read;
                    if (size < total) {
                        this.expect = bytes;
                        return read;
                    }
                    const start = frame + 5;
                    const row = readRowData(
                        buffer,
                        start,
                        info.description,
                        this.encoding,
                        types
                    );

                    // Submit row to result handler.
                    info.handler(row);
                }

                // Keep track of how much data we've consumed.
                read += bytes;
                frame += bytes;

                // If the next message header doesn't fit, we
                // break out and wait for more data to arrive.
                if (size < frame + 5) {
                    this.expect = 5;
                    return read;
                }
            }


            const length = buffer.readInt32BE(frame + 1) - 4;
            const total = length + 5;

            if (size < total + read) {
                this.expect = total;
                break;
            }

            // This is the start offset of the message data.
            const start = frame + 5;

            switch (mtype as Message) {
                case Message.Authenticate: {
                    const code = buffer.readInt32BE(start);
                    switch (code) {
                        case 0: {
                            this.transactionStatus = TransactionStatus.Idle;
                            this.connecting = false;
                            this.connected = true;
                            process.nextTick(() => {
                                this.events.connect.emit({});
                            });
                            break;
                        };
                        case 3:
                            this.writer.password(this.config.password || '');
                            break;
                    }
                    break;
                }
                case Message.BackendKeyData: {
                    this.processId = buffer.readInt32BE(start);
                    this.secretKey = buffer.readInt32BE(start + 4);
                    break;
                }
                case Message.BindComplete: {
                    break;
                };
                case Message.NoData: {
                    this.nameHandlers.shift(true);
                    break;
                }
                case Message.EmptyQueryResponse:
                case Message.CommandComplete: {
                    const info = this.activeDataHandlerInfo;
                    if (info) {
                        info.handler(null);
                        this.activeDataHandlerInfo = null;
                    } else {
                        const handler = this.dataHandlers.shift(true);
                        handler(null);
                    }
                    break;
                }
                case Message.CloseComplete: {
                    break;
                };
                case Message.Error: {
                    const error = this.parseError(
                        buffer.slice(start, start + length));
                    this.events.error.emit(error);
                    const message = error.message;
                    try {
                        const handleData = this.dataHandlers.shift(true);
                        this.nameHandlers.shift(true);
                        handleData(message);
                    } catch (err) {
                        throw new Error('Unexpected error: ' + message);
                    }
                    break;
                }
                case Message.Notice: {
                    const notice = this.parseError(
                        buffer.slice(start, start + length));
                    this.events.notice.emit(notice);
                    break;
                }
                case Message.NotificationResponse: {
                    const reader = new Reader(buffer, start);
                    const processId = reader.readInt32BE();
                    const channel = reader.readCString(this.encoding);
                    const payload = reader.readCString(this.encoding);
                    this.events.notification.emit({
                        processId: processId,
                        channel: channel,
                        payload: payload
                    });
                    break;
                }
                case Message.ParseComplete: {
                    break;
                };
                case Message.ParameterDescription: {
                    let length = buffer.readInt16BE(start);

                    const ps = this.preparedStatements.shift();
                    if (ps) {
                        const types: Array<DataType> = new Array(length);

                        for (let i = 0; i < length; i++) {
                            const offset = start + 2 + i * 4;
                            const dataType = buffer.readInt32BE(offset);
                            types[i] = dataType;
                        }

                        this.writer.bind(ps.name, ps.portal, ps.values, types);
                        this.writer.execute(ps.portal);
                        this.writer.close(ps.name, 'S');
                        if (ps.portal) {
                            this.writer.close(ps.portal, 'P');
                        }
                        this.writer.sync();
                        this.flush();
                    }
                    break;
                }
                case Message.ParameterStatus: {
                    const reader = new Reader(buffer, start);
                    const name = reader.readCString(this.encoding);
                    const value = reader.readCString(this.encoding);
                    this.events.parameter.emit({
                        name: name,
                        value: value
                    });
                    break;
                };
                case Message.ReadyForQuery: {
                    const status = buffer.readInt8(start);
                    this.transactionStatus = status as TransactionStatus;
                    this.ready = true;
                    this.flush();
                    break;
                };
                case Message.RowDescription: {
                    const description = readRowDescription(
                        buffer, start, this.config.types
                    );
                    this.rowDescriptions.push(description);
                    const handler = this.nameHandlers.shift();
                    if (handler) handler(description.names);
                    break;
                };
                default: {
                    logger.warn(`Message not implemented: ${mtype}`);
                    break;
                };
            };

            this.expect = 5;
            read += total;
        }

        return read;
    }
};

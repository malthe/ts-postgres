import { randomBytes } from 'crypto';
import { constants } from 'os';
import { Socket } from 'net';
import { Event as TypedEvent } from 'ts-typed-events';
import { Writable } from 'stream';

import * as defaults from './defaults';
import * as logger from './logging';

import { postgresqlErrorCodes } from './errors';
import { Queue } from './queue';
import { Query } from './query';

import { SecureContextOptions, connect as tls, createSecureContext } from 'tls';

import {
    DataHandler,
    Result as _Result,
    ResultIterator as _ResultIterator,
    ResultRow as _ResultRow,
    makeResult
} from './result';

import {
    readRowData,
    readRowDescription,
    DatabaseError,
    ErrorLevel,
    Message,
    Reader,
    RowDescription,
    SSLResponseCode,
    TransactionStatus,
    Writer
} from './protocol';

import {
    DataFormat,
    DataType,
    Row,
    Value,
    ValueTypeReader
} from './types';

import { md5 } from './utils';

export type Result = _Result<Value>;

export type ResultIterator = _ResultIterator<Value>;

export type ResultRow = _ResultRow<Value>;

export type Connect = (Error | string | null);

export type End = void;

export interface Parameter {
    name: string;
    value: string;
}

export interface ClientNotice extends DatabaseError {
    level: ErrorLevel,
    code: keyof typeof postgresqlErrorCodes,
    message: string
}

export interface DataTypeError {
    dataType: DataType,
    value: Value
}

export const enum SSLMode {
    Disable = 'disable',
    Prefer = 'prefer',
    Require = 'require',
    VerifyCA = 'verify-ca'
}

export interface SSL {
    mode?: (
        SSLMode.Prefer |
        SSLMode.Require |
        SSLMode.VerifyCA
    ),
    options?: SecureContextOptions,
}

export interface Configuration {
    host?: string,
    port?: number,
    user?: string,
    database?: string,
    password?: string,
    types?: Map<DataType, ValueTypeReader>,
    extraFloatDigits?: number,
    keepAlive?: boolean,
    preparedStatementPrefix?: string,
    connectionTimeout?: number,
    ssl?: (SSLMode.Disable | SSL)
}

export interface Notification {
    processId: number,
    channel: string,
    payload?: string
}

export interface PreparedStatement {
    close: (portal?: string) => Promise<void>;
    execute: (
        values?: Value[],
        portal?: string,
        format?: DataFormat | DataFormat[],
        streams?: Record<string, Writable>,
    ) => ResultIterator
}

type Callback<T> = (data: T) => void;

/* eslint-disable  @typescript-eslint/no-explicit-any */
type CallbackOf<U> = U extends any ? Callback<U> : never;

type Event = (
    ClientNotice |
    Connect |
    DatabaseError |
    End |
    Parameter |
    Notification
);

type CloseHandler = () => void;

interface RowDataHandler {
    callback: DataHandler<Row>,
    streams: Record<string, Writable>,
}

type DescriptionHandler = (description: RowDescription) => void;

interface RowDataHandlerInfo {
    readonly handler: RowDataHandler;
    readonly description: RowDescription | null;
}

// Indicates that an error has occurred.
type ErrorHandler = (error: Error | DatabaseError) => void;

const enum Cleanup {
    Bind,
    Close,
    ErrorHandler,
    ParameterDescription,
    PreFlight,
    RowDescription,
}

interface Bind {
    name: string;
    format: DataFormat | DataFormat[]
    portal: string;
    values: Value[],
    close: boolean
}

interface PreFlightQueue {
    descriptionHandler: DescriptionHandler;
    dataHandler: RowDataHandler | null;
    bind: Bind | null;
}

export class Client {
    private readonly events = {
        connect: new TypedEvent<Connect>(),
        end: new TypedEvent<End>(),
        parameter: new TypedEvent<Parameter>(),
        error: new TypedEvent<DatabaseError>(),
        notice: new TypedEvent<ClientNotice>(),
        notification: new TypedEvent<Notification>()
    };

    private ending = false;
    private connected = false;
    private connecting = false;
    private error = false;

    private readonly encoding = 'utf-8';
    private readonly writer: Writer;

    private readonly clientNonce = randomBytes(18).toString('base64');
    private serverSignature: string | null = null;

    private expect = 5;
    private stream = new Socket();
    private mustDrain = false;
    private activeRow: Array<Value> | null = null;

    private bindQueue = new Queue<RowDataHandlerInfo | null>();
    private closeHandlerQueue = new Queue<CloseHandler | null>();
    private cleanupQueue = new Queue<Cleanup>();
    private errorHandlerQueue = new Queue<ErrorHandler>();
    private preFlightQueue = new Queue<PreFlightQueue>();
    private rowDescriptionQueue = new Queue<RowDescription>();
    private parameterDescriptionQueue = new Queue<Array<DataType>>();

    private nextPreparedStatementId = 0;
    private activeDataHandlerInfo: RowDataHandlerInfo | null = null;

    public closed = false;
    public processId: number | null = null;
    public secretKey: number | null = null;
    public transactionStatus: TransactionStatus | null = null;

    constructor(public readonly config: Configuration = {}) {
        this.writer = new Writer(this.encoding);

        this.stream.on('close', () => {
            this.connected = false;
            this.events.end.emit();
        });

        this.stream.on('connect', () => {
            const keepAlive =
                (typeof this.config.keepAlive === 'undefined') ?
                    this.config.keepAlive : true;

            if (keepAlive) {
                this.stream.setKeepAlive(true)
            }

            this.closed = false;
            this.startup();
        });

        /* istanbul ignore next */
        this.stream.on('error', (error: NodeJS.ErrnoException) => {
            if (this.connecting) {
                this.events.connect.emit(error);
            } else {
                // Don't raise ECONNRESET errors - they can & should be
                // ignored during disconnect.
                if (this.ending && error.errno ===
                    constants.errno.ECONNRESET) return;

                this.events.end.emit();
            }
        });

        this.stream.on('finish', () => {
            this.closed = true;
        });
    }

    private startup() {
        const writer = new Writer(this.encoding);

        const ssl =
            defaults.sslMode === SSLMode.Disable ? SSLMode.Disable :
                this.config.ssl || {
                    mode: defaults.sslMode,
                } as SSL;

        const settings = {
            user: this.config.user || defaults.user || '',
            database: this.config.database || defaults.database || '',
            extraFloatDigits: this.config.extraFloatDigits || 0
        }

        if (ssl !== SSLMode.Disable) {
            writer.startupSSL();

            const abort = (error: Connect) => {
                this.events.connect.emit(error);
                this.end();
            }

            const startup = (stream?: Socket) => {
                if (stream) this.stream = stream;
                writer.startup(settings);
                this.listen();
                this.send2(writer);
            }

            const required =
                ssl.mode === SSLMode.Require ||
                ssl.mode === SSLMode.VerifyCA;

            this.stream.once('data', (buffer: Buffer) => {
                const code = buffer.readInt8(0);
                switch (code) {
                    // Server supports SSL connections, continue.
                    case SSLResponseCode.Supported:
                        break

                    // Server does not support SSL connections.
                    case SSLResponseCode.NotSupported:
                        if (required) {
                            abort(
                                new Error(
                                    'Server does not support SSL connections'
                                )
                            );
                        } else {
                            startup();
                        }
                        return;
                    // Any other response byte, including 'E'
                    // (ErrorResponse) indicating a server error.
                    default:
                        abort(
                            new Error(
                                'Error establishing an SSL connection'
                            )
                        );
                        return;
                }

                const context = ssl.options ?
                    createSecureContext(ssl.options) :
                    undefined;

                const options = {
                    socket: this.stream,
                    secureContext: context
                };

                const verify = ssl.mode == SSLMode.VerifyCA;

                const stream = tls(
                    options,
                    () => {
                        if (verify && !stream.authorized) {
                            abort(stream.authorizationError)
                        } else {
                            startup(stream);
                        }
                    }
                );

                stream.on('error', (error) => {
                    abort(error);
                });
            });
        } else {
            writer.startup(settings);
            this.listen();
        }

        this.send2(writer);
    }

    private listen() {
        let buffer: Buffer | null = null;
        let offset = 0;
        let remaining = 0;

        this.stream.on('data', (newBuffer: Buffer) => {
            const length = newBuffer.length;
            const size = length + remaining;

            if (buffer && remaining) {
                const free = buffer.length - offset - remaining;
                let tail = offset + remaining;
                if (free < length) {
                    const tempBuf = Buffer.allocUnsafe(size);
                    buffer.copy(tempBuf, 0, offset, tail);
                    offset = 0;
                    buffer = tempBuf;
                    tail = remaining;
                }
                newBuffer.copy(buffer, tail, 0, length);
            } else {
                buffer = newBuffer;
                offset = 0;
            }

            try {
                const read = this.receive(buffer, offset, size);
                offset += read;
                remaining = size - read;
            } catch (error) {
                if (this.connecting) {
                    this.events.connect.emit(error as Error);
                }
                logger.warn(error);
                this.stream.destroy();
            }
        });

        this.stream.on('drain', () => {
            this.mustDrain = false;
            this.writer.flush();
        });
    }

    connect() {
        if (this.connecting) {
            throw new Error('Already connecting');
        }

        if (this.error) {
            throw new Error('Can\'t connect in error state');
        }

        this.connecting = true;

        const timeout = this.config.connectionTimeout || defaults.connectionTimeout;

        let p = this.events.connect.once().then((error) => {
            if (!error) return;
            this.connecting = false;
            this.stream.destroy();
            throw error;
        });

        const port = this.config.port || defaults.port;
        const host = this.config.host || defaults.host;

        if (host.indexOf('/') === 0) {
            this.stream.connect(host + '/.s.PGSQL.' + port);
        } else {
            this.stream.connect(port, host);
        }

        if (typeof timeout !== "undefined") {
            p = Promise.race([
                p,
                new Promise((_, reject) => setTimeout(
                    () => reject(
                        new Error(`Timeout after ${timeout} ms`)
                    ), timeout
                )),
            ]) as Promise<void>
        }
        return p;
    }

    end() {
        if (this.ending) {
            throw new Error('Already ending');
        }

        if (this.closed) {
            throw new Error('Connection already closed');
        }

        if (this.stream.destroyed) {
            throw new Error('Connection unexpectedly destroyed');
        }

        this.ending = true;

        if (this.connected) {
            this.writer.end();
            this.send();
            this.stream.end();
            this.mustDrain = false;
        } else {
            this.stream.destroy();
        }

        return this.events.end.once();
    }

    on(event: 'connect', callback: Callback<Connect>): void;
    on(event: 'end', callback: Callback<End>): void;
    on(event: 'parameter', callback: Callback<Parameter>): void;
    on(event: 'notification', callback: Callback<Notification>): void;
    on(event: 'error', callback: Callback<DatabaseError>): void;
    on(event: 'notice', callback: Callback<ClientNotice>): void;
    on(event: string, callback: CallbackOf<Event>): void {
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

    prepare(
        text: string,
        name?: string,
        types?: DataType[]): Promise<PreparedStatement> {

        const providedNameOrGenerated = name || (
            (this.config.preparedStatementPrefix ||
                defaults.preparedStatementPrefix) + (
                this.nextPreparedStatementId++
            ));

        return new Promise<PreparedStatement>(
            (resolve, reject) => {
                const errorHandler: ErrorHandler = (error) => reject(error);
                this.errorHandlerQueue.push(errorHandler);
                this.writer.parse(providedNameOrGenerated, text, types || []);
                this.writer.describe(providedNameOrGenerated, 'S');
                this.preFlightQueue.push({
                    descriptionHandler: (description: RowDescription) => {
                        const types = this.parameterDescriptionQueue.shift();
                        this.cleanupQueue.expect(Cleanup.ParameterDescription);

                        resolve({
                            close: () => {
                                return new Promise<void>(
                                    (resolve) => {
                                        this.writer.close(
                                            providedNameOrGenerated, 'S');
                                        this.closeHandlerQueue.push(resolve);
                                        this.cleanupQueue.push(
                                            Cleanup.Close
                                        );
                                        this.writer.flush();
                                        this.send();
                                    }
                                );
                            },
                            execute: (
                                values?: Value[],
                                portal?: string,
                                format?: DataFormat | DataFormat[],
                                streams?: Record<string, Writable>,
                            ) => {
                                const result = makeResult<Value>();
                                result.nameHandler(description.names);
                                const info = {
                                    handler: {
                                        callback: result.dataHandler,
                                        streams: streams || {},
                                    },
                                    description: description,
                                };
                                this.bindAndExecute(info, {
                                    name: providedNameOrGenerated,
                                    portal: portal || '',
                                    format: format || DataFormat.Binary,
                                    values: values || [],
                                    close: false
                                }, types);

                                return result.iterator
                            }
                        })
                    },
                    dataHandler: null,
                    bind: null
                });
                this.writer.sync();
                this.cleanupQueue.push(Cleanup.PreFlight);
                this.cleanupQueue.push(Cleanup.ParameterDescription);
                this.cleanupQueue.push(Cleanup.ErrorHandler);
                this.send();
            });
    }

    query(
        text: string,
        values?: Value[],
        types?: DataType[],
        format?: DataFormat | DataFormat[],
        streams?: Record<string, Writable>):
        ResultIterator {
        const query =
            (typeof text === 'string') ?
                new Query(
                    text,
                    values, {
                    types: types,
                    format: format,
                    streams: streams,
                }) :
                text;
        return this.execute(query);
    }

    private bindAndExecute(
        info: RowDataHandlerInfo,
        bind: Bind,
        types: DataType[]) {
        try {
            this.writer.bind(
                bind.name,
                bind.portal,
                bind.format,
                bind.values,
                types
            );
        } catch (error) {
            info.handler.callback(error as Error);
            return;
        }

        this.bindQueue.push(info);
        this.writer.execute(bind.portal);
        this.cleanupQueue.push(Cleanup.Bind);

        if (bind.close) {
            this.writer.close(bind.name, 'S');
            this.closeHandlerQueue.push(null);
            this.cleanupQueue.push(Cleanup.Close);
        }

        this.writer.sync();
        this.errorHandlerQueue.push(
            (error) => { info.handler.callback(error); }
        );
        this.cleanupQueue.push(Cleanup.ErrorHandler);
        this.send();
    }

    execute(query: Query): ResultIterator {
        if (this.closed && !this.connecting) {
            throw new Error('Connection is closed.');
        }

        const text = query.text;
        const values = query.values || [];
        const options = query.options;
        const format = options ? options.format : undefined;
        const types = options ? options.types : undefined;
        const streams = options ? options.streams : undefined;
        const portal = (options ? options.portal : undefined) || '';
        const result = makeResult<Value>();

        const descriptionHandler = (description: RowDescription) => {
            result.nameHandler(description.names);
        };

        const dataHandler: RowDataHandler = {
            callback: result.dataHandler,
            streams: streams || {},
        };

        if (values && values.length) {
            const name = (options ? options.name : undefined) || (
                (this.config.preparedStatementPrefix ||
                    defaults.preparedStatementPrefix) + (
                    this.nextPreparedStatementId++
                ));

            this.writer.parse(name, text, types || []);
            this.writer.describe(name, 'S');
            this.preFlightQueue.push({
                descriptionHandler: descriptionHandler,
                dataHandler: dataHandler,
                bind: {
                    name: name,
                    portal: portal,
                    format: format || DataFormat.Binary,
                    values: values,
                    close: true
                }
            });
            this.cleanupQueue.push(Cleanup.PreFlight);
        } else {
            const name = (options ? options.name : undefined) || '';
            this.writer.parse(name, text);
            this.writer.bind(name, portal);
            this.bindQueue.push(null);
            this.writer.describe(portal, 'P');
            this.preFlightQueue.push({
                descriptionHandler: descriptionHandler,
                dataHandler: dataHandler,
                bind: null
            });
            this.writer.execute(portal);
            this.writer.close(name, 'S');
            this.cleanupQueue.push(Cleanup.Bind);
            this.cleanupQueue.push(Cleanup.PreFlight);
            this.closeHandlerQueue.push(null);
            this.cleanupQueue.push(Cleanup.Close);
        }

        const stack = new Error().stack;
        this.errorHandlerQueue.push(
            (error) => {
                if (stack !== undefined)
                    error.stack = stack.replace(
                        /(?<=^Error: )\n/,
                        error.toString() + "\n"
                    );
                result.dataHandler(error)
            }
        );

        this.cleanupQueue.push(Cleanup.ErrorHandler);

        this.writer.sync();
        this.send();
        return result.iterator;
    }

    private send() {
        // TODO refactor
        if (!this.connected && !this.ending) return;
        this.mustDrain = !this.writer.send(this.stream);
    }

    private send2(writer: Writer) {
        if (this.mustDrain || !this.stream.writable) return;
        this.mustDrain = !writer.send(this.stream);
    }


    private parseError(buffer: Buffer) {
        let level: DatabaseError['level'] | null = null;
        let code: DatabaseError['code'] | null = null;
        let message: DatabaseError['message'] | null = null;

        const length = buffer.length;
        let offset = 0;

        while (offset < length) {
            const next = buffer.indexOf(0, offset);
            if (next < 0) break;

            const value = buffer.slice(offset + 1, next).toString();
            switch (buffer[offset]) {
                case 0x53: {
                    if (level === null) {
                        level = value as DatabaseError['level'];
                    }
                    break;
                }
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
            }

            offset = next + 1;
        }

        if (level && code && message) {
            return new DatabaseError(level, code, message);
        }

        throw new Error('Unable to parse error message.');
    }

    private receive(buffer: Buffer, offset: number, size: number): number {
        const types = this.config.types || null;
        let read = 0;

        while (size >= this.expect + read) {
            let frame = offset + read;
            let mtype: Message = buffer.readInt8(frame);

            // Fast path: retrieve data rows.
            if (mtype === Message.RowData) {
                const info = this.activeDataHandlerInfo;
                if (!info) {
                    throw new Error('No active data handler');
                }

                if (!info.description) {
                    throw new Error('No result type information');
                }

                const {
                    handler: {
                        streams,
                        callback,
                    },
                    description: {
                        columns,
                        names,
                    }
                } = info;

                let row = this.activeRow;

                const hasStreams = Object.keys(streams).length > 0;
                const mappedStreams = hasStreams ? names.map(
                    name => streams[name] || null
                ) : null;

                while (true) {
                    mtype = buffer.readInt8(frame);
                    if (mtype !== Message.RowData) break;


                    const bytes = buffer.readInt32BE(frame + 1) + 1;
                    const start = frame + 5;

                    if (size < 11 + read) {
                        this.expect = 7;
                        this.activeRow = row;
                        return read;
                    }

                    if (row === null) {
                        const count = buffer.readInt16BE(start);
                        row = new Array<Value>(count);
                    }

                    const startRowData = start + 2;
                    const slice = buffer.slice(startRowData, bytes + read);
                    const end = readRowData(
                        slice,
                        row,
                        columns,
                        this.encoding,
                        types,
                        mappedStreams
                    );

                    const remaining = bytes + read - size;
                    if (remaining <= 0) {
                        callback(row);
                        row = null;
                    } else {
                        const offset = startRowData + end;
                        buffer.writeInt8(mtype, offset - 7);
                        buffer.writeInt32BE(bytes - end - 1, offset - 6);
                        buffer.writeInt16BE(row.length, offset - 2);
                        this.expect = 12;
                        this.activeRow = row;
                        return read + end;
                    }

                    // Keep track of how much data we've consumed.
                    frame += bytes;

                    // If the next message header doesn't fit, we
                    // break out and wait for more data to arrive.
                    if (size < frame + 5) {
                        this.activeRow = row;
                        this.expect = 5;
                        return read;
                    }

                    read += bytes;
                }

                this.activeRow = null;
            }

            const bytes = buffer.readInt32BE(frame + 1) + 1;
            const length = bytes - 5;

            if (size < bytes + read) {
                this.expect = bytes;
                break;
            }

            this.expect = 5;
            read += bytes;

            // This is the start offset of the message data.
            const start = frame + 5;

            switch (mtype as Message) {
                case Message.Authentication: {
                    const writer = new Writer(this.encoding);
                    const code = buffer.readInt32BE(start);
                    outer:
                    /* istanbul ignore next */
                    switch (code) {
                        case 0: {
                            process.nextTick(() => {
                                this.events.connect.emit(null);
                            });
                            break;
                        }
                        case 3: {
                            const s = this.config.password || defaults.password || '';
                            writer.password(s);
                            break;
                        }
                        case 5: {
                            const { user = '', password = '' } = this.config;
                            const salt = buffer.slice(start + 4, start + 8);
                            const shadow = md5(
                                `${password || defaults.password}` +
                                `${user || defaults.user}`
                            );
                            writer.password(`md5${md5(shadow, salt)}`);
                            break;
                        }
                        case 10: {
                            const reader = new Reader(buffer, start + 4);
                            const mechanisms = [];
                            while (true) {
                                const mechanism = reader.readCString(this.encoding);
                                if (mechanism.length === 0) break;
                                if (writer.saslInitialResponse(mechanism, this.clientNonce))
                                    break outer;
                                mechanisms.push(mechanism);
                            }
                            throw new Error(
                                `SASL authentication unsupported (mechanisms: ${mechanisms.join(', ')})`
                            );
                        }
                        case 11: {
                            const data = buffer.slice(start + 4, start + length).toString("utf8");
                            const password = this.config.password || defaults.password || '';
                            this.serverSignature = writer.saslResponse(data, password, this.clientNonce);
                            break;
                        }
                        case 12: {
                            const data = buffer.slice(start + 4, start + length).toString("utf8");
                            if (!this.serverSignature) throw new Error('Server signature missing');
                            writer.saslFinal(data, this.serverSignature);
                            break;
                        }
                        default:
                            throw new Error(
                                `Unsupported authentication scheme: ${code}`
                            );
                    }
                    this.send2(writer);
                    break;
                }
                case Message.BackendKeyData: {
                    this.processId = buffer.readInt32BE(start);
                    this.secretKey = buffer.readInt32BE(start + 4);
                    break;
                }
                case Message.BindComplete: {
                    const info = this.bindQueue.shift();
                    this.cleanupQueue.expect(Cleanup.Bind);
                    if (info) {
                        this.activeDataHandlerInfo = info;
                    }
                    break;
                }
                case Message.NoData: {
                    this.cleanupQueue.expect(Cleanup.PreFlight);
                    const preflight = this.preFlightQueue.shift();
                    if (preflight.dataHandler) {
                        const info = {
                            handler: preflight.dataHandler,
                            description: null,
                        };
                        if (preflight.bind) {
                            this.bindAndExecute(
                                info,
                                preflight.bind,
                                this.parameterDescriptionQueue.shift()
                            );
                        } else {
                            this.activeDataHandlerInfo = info;
                        }
                    } else {
                        preflight.descriptionHandler({
                            columns: new Uint32Array(0),
                            names: [],
                        });
                    }
                    break;
                }
                case Message.EmptyQueryResponse:
                case Message.CommandComplete: {
                    const info = this.activeDataHandlerInfo;
                    if (info) {
                        const status = buffer.slice(
                            start, start + length - 1
                        ).toString();

                        info.handler.callback(status || null);
                        this.activeDataHandlerInfo = null;
                    }
                    break;
                }
                case Message.CloseComplete: {
                    const handler = this.closeHandlerQueue.shift();
                    this.cleanupQueue.expect(Cleanup.Close);
                    if (handler) {
                        handler();
                    }
                    break;
                }
                case Message.ErrorResponse: {
                    const error = this.parseError(
                        buffer.slice(start, start + length));

                    if (this.connecting) throw error;

                    this.events.error.emit(error);
                    loop:
                    while (true) {
                        switch (this.cleanupQueue.shift()) {
                            case Cleanup.Bind: {
                                this.bindQueue.shift();
                                break;
                            }
                            case Cleanup.Close: {
                                this.closeHandlerQueue.shift();
                                break;
                            }
                            case Cleanup.ErrorHandler: {
                                const handler = this.errorHandlerQueue.shift();
                                handler(error);
                                this.error = true;
                                break loop;
                            }
                            case Cleanup.ParameterDescription: {
                                // This does not seem to ever happen!
                                this.parameterDescriptionQueue.shift();
                                break;
                            }
                            case Cleanup.PreFlight: {
                                this.preFlightQueue.shift();
                                break;
                            }
                            case Cleanup.RowDescription: {
                                this.rowDescriptionQueue.shift();
                                break;
                            }
                        }
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
                }
                case Message.ParameterDescription: {
                    const length = buffer.readInt16BE(start);
                    const types: Array<DataType> = new Array(length);
                    for (let i = 0; i < length; i++) {
                        const offset = start + 2 + i * 4;
                        const dataType = buffer.readInt32BE(offset);
                        types[i] = dataType;
                    }

                    this.parameterDescriptionQueue.push(types);
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
                }
                case Message.ReadyForQuery: {
                    if (this.error) {
                        this.error = false
                    } else if (this.connected) {
                        this.errorHandlerQueue.shift();
                        this.cleanupQueue.expect(Cleanup.ErrorHandler);
                    } else {
                        this.connecting = false;
                        this.connected = true;
                    }
                    const status = buffer.readInt8(start);
                    this.transactionStatus = status as TransactionStatus;
                    this.send();
                    break;
                }
                case Message.RowDescription: {
                    this.cleanupQueue.expect(Cleanup.PreFlight);
                    const preflight = this.preFlightQueue.shift();
                    const description = readRowDescription(
                        buffer, start, this.config.types
                    );

                    preflight.descriptionHandler(description);

                    if (preflight.dataHandler) {
                        const info = {
                            handler: preflight.dataHandler,
                            description: description,
                        };

                        if (preflight.bind) {
                            this.bindAndExecute(
                                info,
                                preflight.bind,
                                this.parameterDescriptionQueue.shift()
                            );
                        } else {
                            this.activeDataHandlerInfo = info;
                        }
                    }
                    break;
                }
                default: {
                    logger.warn(`Message not implemented: ${mtype}`);
                    break;
                }
            }
        }

        return read;
    }
}

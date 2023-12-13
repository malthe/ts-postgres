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

import { ConnectionOptions, TLSSocket, connect as tls, createSecureContext } from 'tls';

import {
    DataHandler,
    ResultIterator,
    ResultRecord,
    makeResult
} from './result';

import {
    ClientConnectionDefaults,
    ClientConnectionOptions,
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
    ValueTypeReader
} from './types';

import { md5 } from './utils';

export interface ConnectionInfo  {
    encrypted: boolean;
    parameters: ReadonlyMap<string, string>;
}

export interface ClientNotice extends DatabaseError {
    level: ErrorLevel,
    code: keyof typeof postgresqlErrorCodes,
    message: string
}

export interface DataTypeError {
    dataType: DataType,
    value: any
}

export enum SSLMode {
    Disable = 'disable',
    Prefer = 'prefer',
    Require = 'require',
}

export interface SSL {
    mode: (SSLMode.Prefer | SSLMode.Require),
    options?: ConnectionOptions,
}

export interface Configuration extends Partial<ClientConnectionDefaults & ClientConnectionOptions> {
    user?: string,
    database?: string,
    host?: string,
    port?: number,
    password?: string,
    types?: Map<DataType, ValueTypeReader>,
    bigints?: boolean,
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

export interface PreparedStatement<T = ResultRecord> {
    close: (portal?: string) => Promise<void>;
    execute: (
        values?: any[],
        portal?: string,
        format?: DataFormat | DataFormat[],
        streams?: Record<string, Writable>,
    ) => ResultIterator<T>
}

export type Callback<T> = (data: T) => void;

/* eslint-disable  @typescript-eslint/no-explicit-any */
type CallbackOf<U> = U extends any ? Callback<U> : never;

type Event = (
    ClientNotice |
    DatabaseError |
    Notification
);

type Connect = Error | null;

type End = NodeJS.ErrnoException | null;

type CloseHandler = () => void;

interface RowDataHandler {
    callback: DataHandler,
    streams: Record<string, Writable>,
    bigints: boolean,
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
    values: any[],
    close: boolean
}

interface PreFlightQueue {
    descriptionHandler: DescriptionHandler;
    dataHandler: RowDataHandler | null;
    bind: Bind | null;
}

/** A database client, opening a single connection to the database.
 *
 * @remarks
 * You must open the connection using {@link connect}, otherwise no query will be processed.
 */
export class Client {
    private readonly events = {
        connect: new TypedEvent<Connect>(),
        end: new TypedEvent<End>(),
        error: new TypedEvent<DatabaseError>(),
        notice: new TypedEvent<ClientNotice>(),
        notification: new TypedEvent<Notification>()
    };

    private ending = false;
    private connected = false;
    private connecting = false;
    private error = false;

    private readonly encoding: BufferEncoding;
    private readonly writer: Writer;

    private readonly clientNonce = randomBytes(18).toString('base64');
    private serverSignature: string | null = null;

    private expect = 5;
    private stream = new Socket();
    private mustDrain = false;
    private activeRow: Array<any> | null = null;

    private bindQueue = new Queue<RowDataHandlerInfo | null>();
    private closeHandlerQueue = new Queue<CloseHandler | null>();
    private cleanupQueue = new Queue<Cleanup>();
    private errorHandlerQueue = new Queue<ErrorHandler>();
    private preFlightQueue = new Queue<PreFlightQueue>();
    private rowDescriptionQueue = new Queue<RowDescription>();
    private parameterDescriptionQueue = new Queue<Array<DataType>>();

    private nextPreparedStatementId = 0;
    private activeDataHandlerInfo: RowDataHandlerInfo | null = null;
    private readonly parameters: Map<string, string> = new Map();

    public closed = true;
    public processId: number | null = null;
    public secretKey: number | null = null;
    public transactionStatus: TransactionStatus | null = null;

    /**
    * @param config - An optional configuration object, comprised of connection details
    *     and client configuration. Most of the connection details can also be specified
    *     using environment variables, see {@link Environment}.
    */
    constructor(public readonly config: Configuration = {}) {
        this.encoding = config.clientEncoding || defaults.clientEncoding as BufferEncoding || 'utf-8';
        this.writer = new Writer(this.encoding);

        this.stream.on('close', () => {
            this.closed = true;
            this.events.end.emit(null);
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

                this.events.end.emit(error);
            }
        });

        this.stream.on('finish', () => {
            this.connected = false;
        });
    }

    private startup() {
        const writer = new Writer(this.encoding);

        if (defaults.sslMode && Object.values(SSLMode).indexOf(defaults.sslMode as SSLMode) < 0) {
            throw new Error("Invalid SSL mode: " + defaults.sslMode);
        }

        const ssl = this.config.ssl ??
            (defaults.sslMode as SSLMode || SSLMode.Disable) === SSLMode.Disable
                ? SSLMode.Disable
                : ({ mode: SSLMode.Prefer, options: undefined });

        const settings = {
            user: this.config.user || defaults.user,
            database: this.config.database || defaults.database,
            clientMinMessages: this.config.clientMinMessages,
            defaultTableAccessMethod: this.config.defaultTableAccessMethod,
            defaultTablespace: this.config.defaultTablespace,
            defaultTransactionIsolation: this.config.defaultTransactionIsolation,
            extraFloatDigits: this.config.extraFloatDigits,
            idleInTransactionSessionTimeout: this.config.idleInTransactionSessionTimeout,
            idleSessionTimeout: this.config.idleSessionTimeout,
            lockTimeout: this.config.lockTimeout,
            searchPath: this.config.searchPath,
            statementTimeout: this.config.statementTimeout,
        };

        if (ssl !== SSLMode.Disable) {
            writer.startupSSL();

            const abort = (error: Error) => {
                if (!this.handleError(error)) {
                    throw new Error("Internal error occurred while establishing connection");
                }
                this.events.connect.emit(error);
                this.end();
            }

            const startup = (stream?: Socket) => {
                if (stream) this.stream = stream;
                writer.startup(settings);
                this.receive();
                this.sendUsing(writer);
            }

            this.stream.once('data', (buffer: Buffer) => {
                const code = buffer.readInt8(0);
                switch (code) {
                    // Server supports SSL connections, continue.
                    case SSLResponseCode.Supported:
                        break

                    // Server does not support SSL connections.
                    case SSLResponseCode.NotSupported:
                        if (ssl.mode === SSLMode.Require) {
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
                    secureContext: context,
                    ...(ssl.options ?? {})
                };

                const stream: TLSSocket = tls(
                    options,
                    () => startup(stream)
                );

                stream.on('error', (error: Error) => {
                    abort(error);
                });
            });
        } else {
            writer.startup(settings);
            this.receive();
        }

        this.sendUsing(writer);
    }

    private receive() {
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
                const read = this.handle(buffer, offset, size);
                offset += read;
                remaining = size - read;
            } catch (error) {
                logger.warn(error);
                if (this.connecting) {
                    this.events.connect.emit(error as Error);
                } else {
                    try {
                        while (this.handleError(error as Error)) {
                            logger.info("Cancelled query due to an internal error");
                        }
                    } catch (error) {
                        logger.error("Internal error occurred while cleaning up query stack");
                    }
                }
                this.stream.destroy();
            }
        });

        this.stream.on('drain', () => {
            this.mustDrain = false;
            this.writer.flush();
            this.send();
        });
    }

    /** Connect to the database.
     *
     * @remarks
     * Don't forget to close the connection using {@link end} before exiting.
     *
     * @returns The connection information.
     */
    connect(): Promise<ConnectionInfo> {
        if (this.connecting) {
            throw new Error('Already connecting');
        }

        if (this.error) {
            throw new Error('Can\'t connect in error state');
        }
        this.connecting = true;

        const timeout = this.config.connectionTimeout || defaults.connectionTimeout;

        let p = this.events.connect.once().then((error: Connect) => {
            if (error) {
                this.connecting = false;
                this.stream.destroy();
                throw error;
            }
            return {
                encrypted: this.stream instanceof TLSSocket,
                parameters: this.parameters as ReadonlyMap<string, string>,
            }
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
            ]) as Promise<ConnectionInfo>
        }
        return p;
    }

    /** End the database connection.
     *
     */
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
        return new Promise<void>((resolve, reject) =>
            this.events.end.once().then(
                value => {
                    if (value === null) resolve();
                    reject(value);
                }
            )
        );
    }

    on(event: 'notification', callback: Callback<Notification>): void;
    on(event: 'error', callback: Callback<DatabaseError>): void;
    on(event: 'notice', callback: Callback<ClientNotice>): void;
    on(event: string, callback: CallbackOf<Event>): void {
        switch (event) {
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
        }
    }

    /** Prepare a statement for later execution.
     *
     * @returns A prepared statement object.
     */
    prepare<T = ResultRecord>(text: Query | string): Promise<PreparedStatement<T>> {
        const query = typeof text === 'string' ? {text} : text;
        const providedNameOrGenerated = query.name || (
            (this.config.preparedStatementPrefix ||
                defaults.preparedStatementPrefix) + (
                this.nextPreparedStatementId++
            ));

        return new Promise<PreparedStatement<T>>(
            (resolve, reject) => {
                const errorHandler: ErrorHandler = (error) => reject(error);
                this.errorHandlerQueue.push(errorHandler);
                this.writer.parse(providedNameOrGenerated, query.text, query.types || []);
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
                                values?: any[],
                                portal?: string,
                                format?: DataFormat | DataFormat[],
                                streams?: Record<string, Writable>,
                            ) => {
                                const result = makeResult<T>(query?.transform);
                                result.nameHandler(description.names);
                                const info = {
                                    handler: {
                                        callback: result.dataHandler,
                                        streams: streams || {},
                                        bigints: query.bigints ?? this.config.bigints ?? true,
                                    },
                                    description: description,
                                };
                                this.bindAndExecute(info, {
                                    name: providedNameOrGenerated,
                                    portal: portal || query.portal || '',
                                    format: format || query.format || DataFormat.Binary,
                                    values: values || [],
                                    close: false
                                }, types || query.types);

                                return result.iterator
                            }
                        })
                    },
                    dataHandler: null,
                    bind: null
                });
                this.writer.sync();
                this.cleanupQueue.push(Cleanup.PreFlight);
                this.cleanupQueue.push(Cleanup.ErrorHandler);
                this.send();
            });
    }

    /**
     * Send a query to the database.
     *
     * The query string is given as the first argument, or pass a {@link Query}
     * object which provides more control.
     *
     * @param text - The query string, or pass a {@link Query}
     *     object which provides more control (including streaming values into a socket).
     * @param values - The query parameters, corresponding to $1, $2, etc.
     * @returns A promise for the query results.
     */
    query<T = ResultRecord>(text: Query | string, values?: any[]): ResultIterator<T> {
        const query = typeof text === 'string' ? {text} : text;

        if (this.closed && !this.connecting) {
            throw new Error('Connection is closed.');
        }

        const format = query?.format;
        const types = query?.types;
        const streams = query?.streams;
        const portal = query?.portal || '';
        const result = makeResult<T>(query?.transform);

        const descriptionHandler = (description: RowDescription) => {
            result.nameHandler(description.names);
        };

        const dataHandler: RowDataHandler = {
            callback: result.dataHandler,
            streams: streams || {},
            bigints: query.bigints ?? this.config.bigints ?? true,
        };

        if (values && values.length) {
            const name = (query?.name) || (
                (this.config.preparedStatementPrefix ||
                    defaults.preparedStatementPrefix) + (
                    this.nextPreparedStatementId++
                ));

            this.writer.parse(name, query.text, types || []);
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
            const name = query.name || '';
            this.writer.parse(name, query.text);
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

    private handleError(error: Error): boolean {
        while (true) {
            switch (this.cleanupQueue.shiftMaybe()) {
                case undefined: return false;
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
                    return true;
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
    }

    private send() {
        if (this.mustDrain || !this.connected) return;
        this.sendUsing(this.writer);
    }

    private sendUsing(writer: Writer) {
        if (this.ending) return;
        if (!this.stream.writable) throw new Error('Stream not writable');
        const full = writer.send(this.stream);
        if (full !== undefined) {
            this.mustDrain = !full;
        }
    }

    private parseError(buffer: Buffer) {
        let level: DatabaseError['level'] | null = null;
        let code: DatabaseError['code'] | null = null;
        let message: DatabaseError['message'] | null = null;
        let details: string | null = null;

        const length = buffer.length;
        let offset = 0;

        while (offset < length) {
            const next = buffer.indexOf(0, offset);
            if (next < 0) break;

            const value = buffer.subarray(offset + 1, next).toString();
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
                case 0x44: {
                    details = value;
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
            return new DatabaseError(level, code, details ? `${message}: ${details}` : message);
        }

        throw new Error('Unable to parse error message.');
    }

    private handle(buffer: Buffer, offset: number, size: number): number {
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
                        callback,
                        streams,
                        bigints,
                    },
                    description: {
                        columns,
                        names,
                    }
                } = info;

                let row = this.activeRow;

                const types = this.config.types;
                const encoding = this.encoding;

                const hasStreams = Object.keys(streams).length > 0;
                const mappedStreams = hasStreams ? names.map(
                    name => streams[name]
                ) : undefined;

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
                        row = new Array<any>(count);
                    }

                    const startRowData = start + 2;
                    const reader = new Reader(buffer, startRowData, bytes + read);
                    const end = reader.readRowData(
                        row,
                        columns,
                        encoding,
                        bigints,
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
                            const salt = buffer.subarray(start + 4, start + 8);
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
                            const data = buffer.subarray(start + 4, start + length).toString("utf8");
                            const password = this.config.password || defaults.password || '';
                            this.serverSignature = writer.saslResponse(data, password, this.clientNonce);
                            break;
                        }
                        case 12: {
                            const data = buffer.subarray(start + 4, start + length).toString("utf8");
                            if (!this.serverSignature) throw new Error('Server signature missing');
                            writer.saslFinal(data, this.serverSignature);
                            break;
                        }
                        default:
                            throw new Error(
                                `Unsupported authentication scheme: ${code}`
                            );
                    }
                    this.sendUsing(writer);
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
                    const preflight = this.preFlightQueue.shift();
                    if (preflight.dataHandler) {
                        const info = {
                            handler: preflight.dataHandler,
                            description: null,
                        };
                        if (preflight.bind) {
                            this.cleanupQueue.expect(Cleanup.ParameterDescription);
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
                    this.cleanupQueue.expect(Cleanup.PreFlight);
                    break;
                }
                case Message.EmptyQueryResponse:
                case Message.CommandComplete: {
                    const info = this.activeDataHandlerInfo;
                    if (info) {
                        const status = buffer.subarray(
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
                        buffer.subarray(start, start + length));

                    if (this.connecting) throw error;

                    this.events.error.emit(error);
                    loop:
                    if (!this.handleError(error)) {
                        throw new Error("Internal error occurred while processing database error");
                    }
                    break;
                }
                case Message.Notice: {
                    const notice = this.parseError(
                        buffer.subarray(start, start + length));
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
                    this.cleanupQueue.unshift(Cleanup.ParameterDescription);
                    this.parameterDescriptionQueue.push(types);
                    break;
                }
                case Message.ParameterStatus: {
                    const reader = new Reader(buffer, start);
                    const name = reader.readCString(this.encoding);
                    const value = reader.readCString(this.encoding);
                    this.parameters.set(name, value);
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
                    const preflight = this.preFlightQueue.shift();
                    const reader = new Reader(buffer, start);
                    const description = reader.readRowDescription(this.config.types);

                    preflight.descriptionHandler(description);

                    if (preflight.dataHandler) {
                        const info = {
                            handler: preflight.dataHandler,
                            description: description,
                        };

                        if (preflight.bind) {
                            this.cleanupQueue.expect(Cleanup.ParameterDescription);
                            this.bindAndExecute(
                                info,
                                preflight.bind,
                                this.parameterDescriptionQueue.shift()
                            );
                        } else {
                            this.activeDataHandlerInfo = info;
                        }
                    }

                    this.cleanupQueue.expect(Cleanup.PreFlight);
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

import {
    ClientImpl,
    SSLMode,
} from './client.js';
import type { Configuration, ConnectionInfo } from './client.js';
export type {
    Callback,
    ClientNotice,
    DataTypeError,
    Notification,
    PreparedStatement,
    SSL,
} from './client.js';
export type {
    BufferEncoding,
    Point,
    ValueTypeReader,
} from './types.js';
export type {
    Query,
    QueryOptions,
} from './query.js';
export type {
    Result,
    ResultIterator,
    ResultRecord,
    ResultRow,
} from './result.js';
export type { Environment } from './defaults.js';
export type {
    ClientConnectionDefaults,
    ClientConnectionOptions,
    DatabaseError,
    ErrorLevel,
    TransactionStatus,
} from './protocol.js';

export type {
    Configuration,
};

export {
    DataFormat,
    DataType,
} from './types.js';

export { SSLMode };

interface _Client extends ClientImpl { }

/** A database client, encapsulating a single connection to the database.
 *
 * @interface
 */
export type Client = Omit<_Client, 'connect'> & ConnectionInfo;

/** Connect to the database.
 *
 * @remarks
 * You must close the connection after use using {@link Client.end} to close
 * open handles.
 *
 * @returns A database client, with an active connection.
 */
export async function connect(config: Configuration = {}): Promise<Client> {
    const client = new ClientImpl(config);
    const info = await client.connect();
    return Object.assign(client, info);
}

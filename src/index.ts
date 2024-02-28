import { ClientImpl, type ConnectionInfo } from './client.js';
export {
    SSLMode,
    type ClientNotice,
    type Configuration,
    type DataTypeError,
    type EventListener,
    type EventMap,
    type Notification,
    type PreparedStatement,
    type SSL,
} from './client.js';
import type { Configuration } from './client.js';
export {
    DataFormat,
    DataType,
    type BufferEncoding,
    type Point,
    type ValueTypeReader,
} from './types.js';
export type { Query, QueryOptions } from './query.js';
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

interface _Client extends ClientImpl {}

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

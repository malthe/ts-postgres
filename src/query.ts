import { Writable } from 'stream';
import {
    DataFormat,
    DataType,
} from './types';

export interface QueryOptions {
    /** The query name. */
    readonly name: string;
    /** Whether to use the default portal (i.e. unnamed) or provide a name. */
    readonly portal: string;
    /** Allows making the database native type explicit for some or all columns. */
    readonly types: DataType[];
    /** Whether column data should be transferred using text or binary mode. */
    readonly format: DataFormat | DataFormat[];
    /** A mapping from column name to a socket, e.g. an open file. */
    readonly streams: Record<string, Writable>;
    /** Allows the transformation of column names as returned by the database. */
    readonly transform: (name: string) => string;
    /** Use bigint for the INT8 (64-bit integer) data type. */
    readonly bigints: boolean; 
}

/**
 * A query parameter can be used in place of a query text as the first argument
 * to the {@link Client.query} method.
 * @interface
 */
export type Query = Partial<QueryOptions> & { text: string };

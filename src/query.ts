import { Writable } from 'stream';
import {
    DataFormat,
    DataType,
} from './types';

export interface QueryOptions {
    readonly name: string;
    readonly portal: string;
    readonly types: DataType[];
    readonly format: DataFormat | DataFormat[];
    readonly streams: Record<string, Writable>;
}

export class Query {
    constructor(
        public readonly text: string,
        public readonly values?: any[],
        public readonly options?: Partial<QueryOptions>
    ) { }
}

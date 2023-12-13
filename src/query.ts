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

export type QueryParameter = Partial<QueryOptions> & { text: string };

export class Query {
    public readonly text: string;
    public readonly values?: any[];
    public readonly options?: Partial<QueryOptions>;

    constructor(
        text: QueryParameter | string,
        values?: any[],
        options?: Partial<QueryOptions>
    ) {
        this.values = values;
        this.options = options;
        if (typeof text === 'string') {
            this.text = text;
        } else {
            ({ text: this.text, ...this.options } = {...this.options, ...text});
        }
    }
}

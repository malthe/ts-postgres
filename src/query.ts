import {
    DataFormat,
    DataType,
    Value
} from './types';

export interface QueryOptions {
    readonly name: string;
    readonly portal: string;
    readonly types: DataType[];
    readonly format: DataFormat | DataFormat[];
}

export class Query {
    constructor(
        public readonly text: string,
        public readonly values?: Value[],
        public readonly options?: Partial<QueryOptions>
    ) { }
}

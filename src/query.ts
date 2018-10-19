import {
    DataType,
    Value
} from './types';

export class Query {
    constructor(
        public readonly text: string,
        public readonly values: Value[] = [],
        public readonly types: DataType[] = [],
        public readonly name: string | null = null,
        public readonly portal: string | null = null
    ) { }
}

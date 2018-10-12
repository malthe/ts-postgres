import {
    DataType,
    Value
} from './types';

export class Query {
    constructor(
        public readonly text: string,
        public readonly args: Value[] = [],
        public readonly types: DataType[] = [],
        public readonly name: string | null = null,
        public readonly portal: string | null = null
    ) { }

    public unsafeToSimpleQuery() {
        let text = this.text;
        const params = this.args.map(String);
        for (let i = 0; i < params.length; i++) {
            const param = params[i];
            text = text.replace('$' + (i + 1), param);
        };
        return new Query(text);
    }
}

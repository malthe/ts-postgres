import { describe, test } from 'node:test';
import { Client, Configuration, connect } from '../src/index.js';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Test = (context: {
    client: Client;
    connect: typeof connect;
}) => Promise<void>;

function testWithClient(name: string, fn: Test, timeout?: number) {
    return test(name, { timeout: timeout }, async () => {
        const baseConfig = {
            extraFloatDigits: 2,
            preparedStatementPrefix: name + ' ',
        };
        const client = await connect(baseConfig);
        client.on('notice', console.log);
        const p = fn({
            client,
            connect: (config?: Configuration) =>
                connect({
                    ...baseConfig,
                    ...config,
                }),
        });
        try {
            await p;
        } finally {
            if (!client.closed) {
                await client.end();
            }
        }
        if (!client.closed) throw new Error('Expected client to be closed');
    });
}

export { describe, testWithClient as test };

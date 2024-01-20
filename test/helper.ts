import { describe, test } from 'node:test';
import { Client } from '../src/client';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Test = (client: Client) => Promise<void>;

export function testWithClient(name: string, fn: Test, timeout?: number, connect = true) {
    const client = new Client({
        extraFloatDigits: 2,
        preparedStatementPrefix: name + " "
    });
    client.on('notice', console.log);
    return test(name, {timeout: timeout}, async () => {
        const p2 = connect ? client.connect() : undefined;
        const p1 = fn(client);
        try {
            await Promise.all([p1, p2]);
        } finally {
            if (!client.closed) {
                await client.end();
            }
        }
        if (!client.closed) throw new Error("Expected client to be closed");
    });
}

export {
    describe,
    test
};
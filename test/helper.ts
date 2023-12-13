import { test } from '@jest/globals';
import { Client } from '../src/client';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Test = (client: Client) => Promise<any>;

export function testWithClient(name: string, fn: Test, timeout?: number) {
    const client = new Client({
        extraFloatDigits: 2,
        preparedStatementPrefix: name + " "
    });
    client.on('notice', console.log);
    test(name, async () => {
        let connected = false;
        const p2 = client.connect();
        const p1 = fn(client);
        try {
            await p1;
            await p2;
            connected = true;
        } finally {
            if (!connected) {
                await p2;
            }
            if (!client.closed) {
                await client.end();
                if (!client.closed) throw new Error("Expected client to be closed");
            }
        }
    }, timeout);
}

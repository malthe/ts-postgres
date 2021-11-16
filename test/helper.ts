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
        const p = fn(client);
        await client.connect();
        let closed = false;
        client.on('end', () => { closed = true; });
        try {
            await p;
        } finally {
            if (!closed) {
                await client.end();
                //if (!client.closed) throw new Error("Expected client to be closed");
            }
        }
    }, timeout);
}

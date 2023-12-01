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
        let closed = true;
        let connected = false;
        client.on('connect', () => { closed = false; });
        client.on('end', () => { closed = true; });
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
            if (!closed) {
                await client.end();
                if (!closed) throw new Error("Expected client close event");
                if (!client.closed) throw new Error("Expected client to be closed");
            }
        }
    }, timeout);
}

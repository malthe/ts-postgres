import { Client } from '../src/client';

type Test = (client: Client) => Promise<any>;

export function testWithClient(name: string, fn: Test, timeout?: number) {
    const client = new Client({
        extraFloatDigits: 2
    });
    client.on('notice', console.log);
    test(name, async (done) => {
        const p = fn(client);
        await client.connect();
        let closed = false;
        client.on('end', () => { closed = true; });
        try {
            await p;
        } finally {
            if (!closed) {
                await client.end();
            };
        }
        done();
    }, timeout);
};

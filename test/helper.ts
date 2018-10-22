import {
    Client,
    End
} from '../src/client';

type Test = (client: Client) => Promise<any>;

export function testWithClient(name: string, fn: Test, timeout?: number) {
    const client = new Client({
        extraFloatDigits: 2
    });
    client.on('notice', console.log);
    test(name, async () => {
        const p1 = fn(client);
        const p2 = client.connect();
        let closed = false;
        client.on('end', () => { closed = true; });
        await Promise.all([p1, p2]);
        if (!closed) {
            await client.end();
        };
    }, timeout);
}

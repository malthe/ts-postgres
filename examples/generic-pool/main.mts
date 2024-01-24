import { Client } from 'ts-postgres';
import { createPool } from 'generic-pool';

const pool = createPool({
    create: async () => {
        const client = new Client();
        await client.connect();
        client.on('error', console.log);
        return client;
    },
    destroy: (client: Client) => client.end(),
    validate: async (client: Client) => !client.closed,
}, { testOnBorrow: true });

await pool.use(async (client) => {
    const query = client.query<{ssl: boolean}>("select ssl from pg_stat_ssl");
    const result = await query.one();
    console.log("Encrypted: " + result.ssl);
});

await pool.drain();
await pool.clear();

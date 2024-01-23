import { Client } from 'ts-postgres';
const client = new Client();
const info = await client.connect();
console.log("Encrypted: " + info.encrypted);
await client.end();

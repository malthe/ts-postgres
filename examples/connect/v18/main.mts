import { connect } from 'ts-postgres';
const client = await connect();
console.log('Encrypted: ' + client.encrypted);
await client.end();

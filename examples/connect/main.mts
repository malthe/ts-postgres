import { connect } from 'ts-postgres';
await using client = await connect();
console.log('Encrypted: ' + client.encrypted);

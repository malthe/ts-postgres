const { connect } = require('ts-postgres');
module.exports = (async () => {
    const client = await connect();
    console.log('Encrypted: ' + client.encrypted);
    await client.end();
})();

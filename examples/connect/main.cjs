const { connect } = require('ts-postgres');
module.exports = connect().then((client) => {
    console.log('Encrypted: ' + client.encrypted);
    return client.end();
});

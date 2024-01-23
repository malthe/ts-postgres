const { Client } = require('ts-postgres');
const client = new Client();
module.exports = client.connect().then(
  (info) => {
    console.log("Encrypted: " + info.encrypted);
    return client.end();
  }
);

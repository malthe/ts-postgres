![Build Status](https://github.com/malthe/ts-postgres/actions/workflows/main.yml/badge.svg)
<span class="badge-npmversion"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/v/ts-postgres.svg" alt="NPM version" /></a></span>
<span class="badge-npmdownloads"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/dm/ts-postgres.svg" alt="NPM downloads" /></a></span>

Non-blocking PostgreSQL client for Node.js written in TypeScript.

### Install

To install the latest version of this library:

```sh
$ npm install ts-postgres
```

### Features

- Fast!
- Supports binary and text value formats (result data always uses binary)
- Multiple queries can be sent at once (pipeline)
- Extensible value model
- Hybrid query result object
  - Iterable (synchronous or asynchronous; one object at a time)
  - Rows and column names
  - Streaming data directly into a socket
- Supports CommonJS and ESM modules
- No dependencies

See the [documentation](https://malthe.github.io/ts-postgres/) for a complete reference.

---

## Usage

The client uses an async/await-based programming model.

```typescript
import { connect } from 'ts-postgres';

interface Greeting {
  message: string;
}

const client = await connect();

try {
  // The query method is generic on the result row.
  const result = client.query<Greeting>(
    "SELECT 'Hello ' || $1 || '!' AS message",
    ['world'],
  );

  for await (const obj of result) {
    // 'Hello world!'
    console.log(obj.message);
  }
} finally {
  await client.end();
}
```

With TypeScript 5.2+ there is also support for `await using`:
```typescript
await using client = await connect();
// Will be disposed of automatically at the end of the block.
```

Waiting on the result (i.e., result iterator) returns the complete query result.

```typescript
const result = await client.query(...)
```

If the query fails, an exception is thrown.

### Connection options

The client constructor takes an optional
[Configuration](https://malthe.github.io/ts-postgres/interfaces/Configuration.html) object.

For example, to connect to a remote host use the _host_ configuration key:

```typescript
const client = await connect({"host": <hostname>});
```

The following table lists the various configuration options and their
default value when applicable.

| Key                     | Type                             | Default                                    |
| ----------------------- | :------------------------------- | ------------------------------------------ |
| host                    | `string`                         | "localhost"                                |
| port                    | `number`                         | 5432                                       |
| user                    | `string`                         | _The username of the process owner_        |
| database                | `string`                         | "postgres"                                 |
| password                | `string`                         |                                            |
| types                   | `Map<DataType, ValueTypeReader>` | _Default value mapping for built-in types_ |
| extraFloatDigits        | `number`                         | 0                                          |
| keepAlive               | `boolean`                        | true                                       |
| preparedStatementPrefix | `string`                         | "tsp\_"                                    |
| connectionTimeout       | `number`                         | 10                                         |
| ssl                     | `(SSLMode.Disable \| SSL)`       | `{ mode: SSLMode.Prefer }`                 |

When applicable, "PG" environment variables used by _libpq_ apply, see
the PostgreSQL documentation on [environment
variables](https://www.postgresql.org/docs/current/libpq-envars.html).

#### SSL/TLS configuration

As shown in the configuration options table in the previous section,
the default behavior is to _prefer_ making a secure connection. That
is, if the database has SSL/TLS configured, then the client will
either make a secure connection or not connect at all.

For a self-signed certificate or a certificate that's not verifiable
by the system certificates, either provide the signing certificate
using the `NODE_EXTRA_CA_CERTS` environment variable, or disable
SSL/TLS altogether using `SSLMode.Disable` or the environment variable
`PGSSLMODE=disable`.

Note that _libpq_ supports a number of additional [SSL/TLS connection
modes](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNECT-SSLMODE)
but most of them do not sit well with Node's [tls
module](https://nodejs.org/api/tls.html) and are not offered here.

### Querying

The `query` method accepts a text string or a
[Query](https://malthe.github.io/ts-postgres/interfaces/Query.html) object 
as the first parameter, and a tuple of values as the second parameter. 

The initial example above could be written as:

```typescript
const query = { text: "SELECT 'Hello ' || $1 || '!' AS message" };
const result = await client.query<Greeting>(query, ['world']);
```

The `Query` object has a number of optional properties that can change
how the query is carried out, including column name transformation.

If the object type is omitted, it defaults to `Record<string, any>`, but
providing a type ensures that the object values are typed, both when
accessed via the iterator or record interface (see below).

### Passing query parameters

Query parameters use the format `$1`, `$2` etc.

When a specific data type can't be inferred from the query, PostgreSQL
uses `DataType.Text` as the default data type (which is mapped to the
string type in TypeScript). An explicit type can be provided in two
different ways:

1. Using type cast in the query, e.g. `$1::int`.

2. By passing a list of types to the query method:

   ```typescript
   import { DataType } from 'ts-postgres';
   const result = await client.query(
     "SELECT $1 || ' bottles of beer'",
     [99],
     [DataType.Int4],
   );
   ```

Note that the `number` type in TypeScript has a maximum safe integer
value which is 2⁵³ – 1 (also given in the `Number.MAX_SAFE_INTEGER` constant),
a value which lies between `DataType.Int4` and `DataType.Int8`. For numbers
which can take on a value that's outside the safe range, use `DataType.Int8`
(which translates to a `bigint` in TypeScript.)

There's an optional setting `bigints` which can be configured on the client and/or
specified for each query. It defaults to _true_, but can be set to _false_ in which
case `number` is always used instead of `bigint` for `DataType.Int8` (throwing an
error if a query returns a value outside of the safe integer range.)

Using a [check constraint](https://www.postgresql.org/docs/current/ddl-constraints.html)
is recommended to ensure that values fit into the safe
integer range, e.g. `CHECK (id < POWER(2, 53) - 1)`.

### Iterator interface

The query result can be iterated over, either asynchronously, or after being awaited. The returned objects are reified representations of the result rows, provided as _objects_ of the generic type parameter specified for the query (optional, it defaults to `Record<string, any>`).

To extract all objects from the query result, you can use the _spread_ operator:

```typescript
const result = await client.query('SELECT generate_series(0, 9) AS i');
const objects = [...result];
```

The asynchronous await syntax around for-loops is another option:

```typescript
const result = client.query(...);
for await (const obj of result) {
  console.log('The number is: ' + obj.i); // 1, 2, 3, ...
}
```

### Result interface

The awaited result object provides an interface based on rows and column names.

```typescript
for (const row of result.rows) {
  // Using the array indices:
  console.log('The number is: ' + row[0]); // 1, 2, 3, ...

  // Using the column name:
  console.log('The number is: ' + row.get('i')); // 1, 2, 3, ...
}
```

Column names are available via the `names` property.

### Streaming

A query can support streaming of one or more columns directly into an
asynchronous stream such as a network socket, or a file.

Assuming that `socket` is a writable stream:

```typescript
const result = await client.query({
  text: 'SELECT some_bytea_column',
  streams: { some_bytea_column: socket },
});
```

This can for example be used to reduce time to first byte and memory use.

### Multiple queries

The query command accepts a single query only. If you need to send multiple queries, just call the method multiple times. For example, to send an update command in a transaction:

```typescript
client.query('begin');
client.query('update ...');
await client.query('commit');
```

The queries are sent back to back over the wire, but PostgreSQL still processes them one at a time, in the order they were sent (first in, first out).

### Prepared statements

You can prepare a query and subsequently execute it multiple times. This is also known as a "prepared statement".

```typescript
const statement = await client.prepare(
  `SELECT 'Hello ' || $1 || '!' AS message`,
);
for await (const object of statement.execute(['world'])) {
  console.log(object.message); // 'Hello world!'
}
```

When the prepared statement is no longer needed, it should be closed to release the resource.

```typescript
await statement.close();
```
With TypeScript 5.2+ it's also possible to use the `await using` construct which automatically closes the statement at the end of the block.


Prepared statements can be used (executed) multiple times, even concurrently.

## Notes

Queries with parameters are sent using the prepared statement variant of the extended query protocol. In this variant, the type of each parameter is determined prior to parameter binding, ensuring that values are encoded in the correct format.

If a query has no parameters, it uses the portal variant which saves a round trip.

The copy commands are not supported.

## FAQ

1. _How do I set up a connection pool?_ You can for example use the [generic-pool](https://www.npmjs.com/package/generic-pool) library.

   See the [generic-pool](./examples/generic-pool/) code example.

2. _How do I convert column names to camelcase?_ Use the `transform` option:

   ```typescript
   const camelcase = (s: string) => s.replace(/(_\w)/g, k => k[1].toUpperCase());
   const result = client.query({text: ..., transform: camelcase})
   ```

3. _How do I use LISTEN/NOTIFY?_ Send `LISTEN` as a regular query, then subscribe to
   notifications, filtering out the relevant channels.

   ```typescript
   import type { Notification } from 'ts-postgres';

   const channel = 'test';
   client.on('notification', (message: Notification) => {
     if (message.channel === channel) {
       // Do stuff
     }
   });
   await client.query(`LISTEN ${channel}`);
   ```

## Benchmarking

Use the following environment variable to run tests in "benchmark" mode.

```bash
$ NODE_ENV=benchmark npm run test
```

## Support

ts-postgres is free software. If you encounter a bug with the library please open an issue on the [GitHub repo](https://github.com/malthe/ts-postgres).

## License

Copyright (c) 2018-2024 Malthe Borch (mborch@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

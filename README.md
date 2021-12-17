# ts-postgres

![Build Status](https://github.com/malthe/ts-postgres/actions/workflows/main.yml/badge.svg)
<span class="badge-npmversion"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/v/ts-postgres.svg" alt="NPM version" /></a></span>
<span class="badge-npmdownloads"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/dm/ts-postgres.svg" alt="NPM downloads" /></a></span>

Non-blocking PostgreSQL client for Node.js written in TypeScript.

### Install

To install the latest version of this library:

```sh
$ npm install ts-postgres@latest
```

### Features

* Fast!
* Supports both binary and text value formats
  * Result data is currently sent in binary format only
* Multiple queries can be sent at once (pipeline)
* Extensible value model
* Hybrid query result object
  * Iterable (synchronous or asynchronous; one row at a time)
  * Promise-based
  * Streaming

---

## Usage

The client uses an async/await-based programming model.

```typescript
import { Client } from 'ts-postgres';

async function main() {
    const client = new Client();
    await client.connect();

    try {
        // Querying the client returns a query result promise
        // which is also an asynchronous result iterator.
        const result = client.query(
            "SELECT 'Hello ' || $1 || '!' AS message",
            ['world']
        );

        for await (const row of result) {
            // 'Hello world!'
            console.log(row.get('message'));
        }
    } finally {
        await client.end();
    }
}

await main()
```
Waiting on the result (i.e., result iterator) returns the complete query result.

```typescript
const result = await client.query(...)
```
If the query fails, an exception is thrown.

### Connection options

The client constructor takes an optional
[Configuration](src/client.ts#L88) object.

For example, to connect to a remote host use the *host* configuration key:

```typescript
const client = new Client({"host": <hostname>});
```

The following table lists the various configuration options and their
default value when applicable.

| Key                     | Type                             | Default                                    |
|-------------------------|:---------------------------------|--------------------------------------------|
| host                    | `string`                         | "localhost"                                |
| port                    | `number`                         | 5432                                       |
| user                    | `string`                         | *The username of the process owner*        |
| database                | `string`                         | "postgres"                                 |
| password                | `string`                         |                                            |
| types                   | `Map<DataType, ValueTypeReader>` | *Default value mapping for built-in types* |
| extraFloatDigits        | `number`                         | 0                                          |
| keepAlive               | `boolean`                        | true                                       |
| preparedStatementPrefix | `string`                         | "tsp_"                                     |

### Querying

The `query` method accepts a `Query` object or a number of arguments
that together define the query, the first argument (query text) being
the only required one.

The initial example above could be written as:
```typescript
const query = new Query(
    "SELECT 'Hello ' || $1 || '!' AS message",
    ['world']
);
const result = await client.execute(query);
```

### Passing query parameters

Query parameters use the format `$1`, `$2` etc.

When a specific data type is not inferrable from the query, PostgreSQL
uses `DataType.Text` as the default data type (which is mapped to the
string type in TypeScript). An explicit type can be provided in two
different ways:

1. Using type cast in the query, e.g. `$1::int`.

2. By passing a list of types to the query method:

   ```typescript
   import { DataType } from 'ts-postgres';
   const result = await client.query(
      "select $1 || ' bottles of beer'", [99], [DataType.Int4]
   );
    ```

Note that the `number` type in TypeScript has a maximum safe integer
value which lies between and `DataType.Int8` – given by
`Number.MAX_SAFE_INTEGER`. To use `DataType.Int8` the `bigint` type
should be used.

### Iterator interface

Whether we're operating on a stream or an already waited for result set, the iterator interface provides the most high-level row interface. This also applies when using the _spread_ operator:

```typescript
const rows = [...result];
```

Each row provides direct access to values through its ``data`` attribute, but we can also get a value by name using the ``get(name)`` method.

```typescript
for (const row of rows) {
  console.log('The number is: ' + row.get('i')); // 1, 2, 3, ...
}
```
Note that values are polymorphic and need to be explicitly cast to a concrete type such as ``number`` or ``string``.

### Result interface

This interface is available on the already waited for result object. It makes data available in the ``rows`` attribute as an array of arrays (of values).
```typescript
for (const row of result.rows) {
  console.log('The number is: ' + row[0]); // 1, 2, 3, ...
}
```
This is the most efficient way to work with result data. Column names are available as the ``names`` attribute of a result.

### Streaming

A query can support streaming of one or more columns directly into an
asynchronous stream such as a network socket, or a file.

Assuming that `socket` is a writable stream:

```typescript
const query = new Query(
    "SELECT some_bytea_column",
    {streams: {"some_bytea_column": socket}}
);
const result = await client.execute(query);
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
    `SELECT 'Hello ' || $1 || '!' AS message`
);
for await (const row of statement.execute(['world'])) {
    console.log(row.get('message')); // 'Hello world!'
}
```
When the prepared statement is no longer needed, it should be closed to release the resource.
```typescript
await statement.close();
```
Prepared statements can be used (executed) multiple times, even concurrently.

## Notes

Queries with parameters are sent using the prepared statement variant of the extended query protocol. In this variant, the type of each parameter is determined prior to parameter binding, ensuring that values are encoded in the correct format.

If a query has no parameters, it uses the portal variant which saves a round trip.

The copy commands are not supported.

## FAQ

1. _How do I set up a pool of connections?_ You can for example use the [generic-pool](https://www.npmjs.com/package/generic-pool) library:

   ```typescript
   import { createPool } from 'generic-pool';

   const pool = createPool({
       create: async () => {
           const client = new Client();
           return client.connect().then(() => {
               client.on('error', console.log);
               return client;
           });
       },
       destroy: async (client: Client) => {
           return client.end().then(() => { })
       },
       validate: (client: Client) => {
           return Promise.resolve(!client.closed);
       }
   }, { testOnBorrow: true });

   pool.use(...)
   ```

## Benchmarking

Use the following environment variable to run tests in "benchmark" mode.

```bash
$ NODE_ENV=benchmark npm run test
```

## Support

ts-postgres is free software.  If you encounter a bug with the library please open an issue on the [GitHub repo](https://github.com/malthe/ts-postgres).

## License

Copyright (c) 2018-2021 Malthe Borch (mborch@gmail.com)

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

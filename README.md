# ts-postgres

[![Build Status](https://secure.travis-ci.org/malthe/ts-postgres.svg?branch=master)](http://travis-ci.org/malthe/ts-postgres)
<span class="badge-npmversion"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/v/ts-postgres.svg" alt="NPM version" /></a></span>
<span class="badge-npmdownloads"><a href="https://npmjs.org/package/ts-postgres" title="View this project on NPM"><img src="https://img.shields.io/npm/dm/ts-postgres.svg" alt="NPM downloads" /></a></span>

Non-blocking PostgreSQL client for Node.js written in TypeScript.

### Install

This library does not yet have a stable release. The following command installs the latest pre-release.

```sh
$ npm install ts-postgres@next
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

---

## Usage

The client uses an async/await-based programming model.

```typescript
import { Client } from 'ts-postgres';

async function main() {
    const client = new Client();
    await client.connect();

    const stream = client.query(
        `SELECT 'Hello ' || $1 || '!' AS message`,
        ['world']
    );

    for await (const row of stream) {
        console.log(row.get('message')); // 'Hello world!'
    }

    await client.end();
}

main()
```
The example above uses the variable ``stream`` to indicate that the result set is made available as it arrives on the connection. But we'll often want to just wait for the entire result set to arrive before starting to process the data.

```typescript
const result = await client.query('select generate_series(1, 10)');
```
If the query fails, waiting for the result will throw an exception.

### Iterator interface

Whether we're operating on a stream or an already waited for result set, the iterator interface provides the most high-level row interface. This also applies when using the _spread_ operator:

```typescript
const rows = [...result];
```

Each row provides direct access to values through its ``data`` attribute, but we can also get a value by name using the ``get(name)`` method.

```typescript
for (let row of rows) {
  console.log('The number is: ' + row.get('i')); // 1, 2, 3, ...
}
```
Note that values are polymorphic and need to be explicitly cast to a concrete type such as ``number`` or ``string``.

### Result interface

This interface is available on the already waited for result object. It makes data available in the ``rows`` attribute as an array of arrays (of values).
```typescript
for (let row of result.rows) {
  console.log('The number is: ' + row[0]); // 1, 2, 3, ...
}
```
This is the most efficient way to work with result data. Column names are available as the ``names`` attribute of a result.

### Multiple queries

The query command accepts a single query only. If you need to send multiple queries, just call the method multiple times. For example, to send an update command in a transaction:
```typescript
client.query('begin');
client.query('update ...');
await client.query('commit');
```
The queries are sent back to back over the wire, but PostgreSQL still processes them one at a time, in the order they were sent (first in, first out).

## Notes

Queries are sent using the prepared statement variant of the extended query protocol. In this variant, the type of each parameter is determined prior to parameter binding, ensuring that values are encoded in the correct format.

The copy commands are not supported.

## Benchmarking

Use the following environment variable to run tests in "benchmark" mode.

```bash
$ NODE_ENV=benchmark npm run test
```

## Support

ts-postgres is free software.  If you encounter a bug with the library please open an issue on the [GitHub repo](https://github.com/malthe/ts-postgres).

## License

Copyright (c) 2018 Malthe Borch (mborch@gmail.com)

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

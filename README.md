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

* Binary protocol
* Pipelined queries
* Extensible value model
* Flexible query result
  * Asynchronous iteration or all-at-once
  * Result data is available in either array or map form

---

## Usage

The client uses an async/await-based programming model.

```typescript
import { Client } from 'ts-postgres';

const client = new Client();
await client.connect()

const iterator = client.query('SELECT $1::text AS message', ['Hello world!']);
for await (const item in iterator) {
  console.log(item.get('message'));
}

await client.end()
```

## Notes

Queries are sent using the prepared statement variant of the extended query protocol. In this variant, the type of each parameter is determined prior to parameter binding, ensuring that values are encoded in the correct format.

Multiple queries can be sent at once, without waiting for results. The client automatically manages the pipeline and maps the result data to the corresponding promise. Note that each client opens exactly one connection to the database and thus, concurrent queries ultimately execute "first in, first out" on the database side.

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

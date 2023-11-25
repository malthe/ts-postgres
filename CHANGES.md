In next release ...

- Database name now implicitly defaults to the user name.

- Add additional client connection configuration options.

- Result rows are now themselves iterable.

- Use `bigint` everywhere as a type instead of `BigInt`.

1.4.0 (2023-11-10)
------------------

- A statement error during the processing of a prepared statement is
  now handled correctly (#73).

- An internal error now cancels all queries.

- The [ts-typed-events](https://www.npmjs.com/package/ts-typed-events)
  dependency was updated to version 3.0.0.


1.3.1 (2023-06-19)
------------------

- Added details of database error to thrown error message (#64).


1.3.0 (2022-08-22)
------------------

- Fix prepare statement with no return data (#56).


1.2.1 (2021-12-23)
------------------

- Fix range error that could occur when parsing an incomplete data row
  after one or more previous messages had already been processed.

- The stack trace of a query error now originates in calling code,
  rather than an async listening thread.

- Fix error handling for queries that return no data.

- Fix error handling during connection attempts such that promise
  returned by `connect()` is rejected in case of an error.

- Add support for SCRAM-SHA-256 authentication.

- Fix issue where a query with multiple columns would yield incomplete
  rows when protocol data spans multiple receive buffers.

1.2.0 (2021-11-19)
------------------

- The "execute" method is now public and must be used now when passing
  a query object rather than individual arguments when querying.

- Add support for streaming binary column data.

- Add SSL support.

- Fix buffer race condition that could lead to data corruption.

- Fix issue with `BYTEA` where a returned buffer would incorrectly be
  a slice into an internal buffer.

- The environment variables `PGHOST` and `PGPORT` can now be set to
  override the static defaults "localhost" and 5432.

- Fixed an issue where a connection error would not reject the connect
  promise.

- Added optional `connectionTimeout` configuration setting (in
  milliseconds).

- Updated dependency on "ts-typed-events".

1.1.3 (2020-02-23)
------------------

- Added support for `BigInt`.

1.1.2 (2019-12-28)
------------------

- Fixed handling of null values in arrays. [matthieusieben]


1.1.1 (2019-12-06)
------------------

- Fixed `ECONNRESET` deprecation.

- Enable parsing of `jsonb` and `uuid` arrays. [matthieusieben]

- Fixed error when parsing null arrays. [matthieusieben]

- Encoding argument now uses `BufferEncoding` type.


1.1.0 (2019-06-24)
------------------

- The rejection value is now a `DatabaseError` object which inherits
  from `Error`. Previously, this value was a plain string.

- Add command status string to result object.

- Fix password authentication.

- Add support for MD5 authentication.

- Handle `JSONB` and null values.


1.0.2 (2019-02-08)
------------------

- Connection state variable 'closed' is now public. This should be
  checked before using the connection to make sure that an unexpected
  error has not occurred which would close the connection.

- Handle protocol errors gracefully, passing error to open data
  handlers and marking the connection as 'closed'.


1.0.1 (2019-01-13)
------------------

- Parse JSON data only on non-null value.

- Fixed an issue where getting a column would result in an infinite loop.

- Fixed an issue with `Result.one()` and `Result.first()` methods
  where a rejection would be uncaught.


1.0.0 (2019-01-08)
------------------

- Initial release.

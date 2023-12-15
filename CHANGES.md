In the next release ...

- Fix issue handling connection error during secure startup.

1.8.0 (2023-12-14)
------------------

- Reduce buffer allocation and intelligently scale initial allocation when creating
  a new buffer.

- Both the `Query` object and client configuration now provide an optional `bigints`
  setting which decides whether to use bigints or the number type for the INT8
  data type. The setting is enabled by default.

- Add support for the INT2 and INT8 array types.

- The `Connect` and `End` events have been removed, in addition to the `Parameter`
  event; the `connect` method now returns an object with information about the
  established connection, namely whether the connection is encrypted and the
  connection parameters sent by the server.

- Fixed a regression where some symbols were not correctly exposed for importing.

1.7.0 (2023-12-13)
------------------

- The `execute` method has been removed.

- The querying options now include an optional `transform` property which must be
  a function which takes a column name input, allowing the transformation of column
  names into for example _camel-case_.

- The `query` method now accepts a `Query` object as the first argument in
  addition to a string argument, but no longer accepts any additional arguments
  after `values`. The query options must now be provided using the query argument
  instead.

  The same change has been made to `prepare`.

1.6.0 (2023-12-13)
------------------

- The iterator methods now return reified representations of the query result
  (i.e. objects), carrying the generic type parameter specified for the query
  (#83).

- The result rows now extend the array type, providing `get` and `reify` methods.
  This separates the query results interface into an iterator interface (providing
  objects) and a result interface (providing rows and column names).

1.5.0 (2023-12-06)
------------------

- The `Value` type has been replaced with `any`, motivated by the new
  generic result type as well as the possibility to implement custom
  value readers which could return objects of any type.

- Query results are now generic with typing support for the `get`
  method on each row.

  In addition, a new `reify` method now produces records which conform
  to the specified type. This method is available on all of the result
  objects.

- Use lookup table to optimize `get` method.

- The `connect` method now returns a boolean status of whether the
  connection is encrypted.

- The "verify-ca" SSL mode has been removed, favoring "require"; in addition, both
  "prefer" and "require" imply certificate verification. To use a self-signed
  certificate, use for example the `NODE_EXTRA_CA_CERTS` environment variable
  to provide the public key to the runtime as a trusted certificate.

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

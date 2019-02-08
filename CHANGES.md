# Changes

1.0.3 (unreleased)
------------------

- In next release ...


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

export const host = 'localhost';
export const port = 5432;
export const user =
    process.platform === 'win32' ? process.env.USERNAME : process.env.USER;
export const database = 'postgres';
export const preparedStatementPrefix = 'tsp_';

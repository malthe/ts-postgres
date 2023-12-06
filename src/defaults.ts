function secToMsec(value?: number) {
    if (typeof value === "number" && !isNaN(value)) {
        return value * 1000;
    }
}

/** Environment variables providing connection configuration defaults.
 *
 *  See {@link https://www.postgresql.org/docs/current/libpq-envars.html} for a detailed description.
 */
export interface Environment {
    PGCLIENTENCODING: string;
    PGCONNECT_TIMEOUT: string;
    PGDATABASE: string;
    PGHOST: string;
    PGPASSWORD: string;
    PGPORT: string;
    PGSSLMODE: string;
    PGUSER: string;
}

const env = process.env as Partial<Environment>;

export const host = env.PGHOST || 'localhost';
export const port = parseInt(env.PGPORT as string, 10) || 5432;
export const user = env.PGUSER || (
    process.platform === 'win32' ? process.env.USERNAME : process.env.USER
) as string;
export const database = env.PGDATABASE;
export const password = env.PGPASSWORD;
export const preparedStatementPrefix = 'tsp_';
export const sslMode = env.PGSSLMODE;
export const connectionTimeout = secToMsec(
    parseInt(env.PGCONNECT_TIMEOUT as string, 10)
);
export const clientEncoding = env.PGCLIENTENCODING;

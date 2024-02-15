import { userInfo } from 'node:os';

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

function secToMsec(value?: number) {
    if (typeof value === 'number' && !isNaN(value)) {
        return value * 1000;
    }
}

export class Defaults {
    constructor(
        env: Environment,
        readonly host = env.PGHOST || 'localhost',
        readonly port = parseInt(env.PGPORT as string, 10) || 5432,
        readonly user = env.PGUSER || userInfo().username,
        readonly database = env.PGDATABASE,
        readonly password = env.PGPASSWORD,
        readonly preparedStatementPrefix = 'tsp_',
        readonly sslMode = env.PGSSLMODE,
        readonly connectionTimeout = secToMsec(
            parseInt(env.PGCONNECT_TIMEOUT as string, 10),
        ),
        readonly clientEncoding = env.PGCLIENTENCODING,
    ) {}
}

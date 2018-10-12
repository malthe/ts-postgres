import {
    Client,
    End
} from '../src/client';

export type Test = (client: Client) => void;

export function withClient(fns: Test[]): jest.EmptyFunction {
    return () => {
        let clients: Client[] = [];
        let promises: Promise<End>[] = [];
        let closed: Client[] = [];

        afterEach(() => {
            const conn = clients.shift();
            if (!conn) return;

            // Some of the tests close the clients prior to
            // stopping.
            if (closed.indexOf(conn) === -1) {
                const p = conn.end();
                promises.push(p);
            }
        });

        afterAll(async () => {
            return Promise.all(promises);
        });

        for (let fn of fns) {
            const conn = new Client({
                suppressDataTypeNotSupportedWarning: true,
                extraFloatDigits: 2
            });
            let _ = conn.connect();
            conn.on('error', console.log);
            conn.on('notice', console.log);
            conn.on('end', () => { closed.push(conn); });
            clients.push(conn);
            fn(conn)
        }
    }
}

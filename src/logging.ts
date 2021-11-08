/* eslint-disable  @typescript-eslint/no-explicit-any */
function make(f: (data: any) => void) {
    let last: any = null;
    let count = 0;

    const log = (data: any) => {
        return f(`ts-postgres: ${data}`);
    };

    return (data: any) => {
        if (data === last) {
            count++;
        } else {
            if (count && last) {
                log(`${last} (repeated ${count} times)`);
                count = 0;
            }
            last = data;
            log(data);
        }
    }
}

export const debug = make(console.debug);
export const error = make(console.error);
export const info = make(console.info);
export const log = make(console.log);
export const warn = make(console.warn);

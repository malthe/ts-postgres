export function sum(...nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0);
};

export function zip<K, V>(keys: K[], values: V[]) {
    const length = Math.min(keys.length, values.length);
    const map: Map<K, V> = new Map();
    for (let i = 0; i < length; i++) {
        map.set(keys[i], values[i]);
    }
    return map;
}

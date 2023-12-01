import { createHash, createHmac, BinaryLike } from 'crypto';

export function xorBuffers(a: Buffer, b: Buffer): Buffer {
    if (a.length !== b.length) {
        throw new Error('Buffer length mismatch');
    }
    if (a.length === 0 || b.length === 0) {
        throw new Error('Buffers cannot be empty');
    }
    return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
}

export function hmacSha256(key: BinaryLike, msg: Buffer | string) {
    return createHmac('sha256', key).update(msg).digest();
}

export function sha256(key: Buffer): Buffer {
    return createHash('sha256').update(key).digest();
}

export function hi(password: string, saltBytes: Buffer, iterations: number) {
    let ui1 = hmacSha256(password, Buffer.concat(
        [saltBytes, Buffer.from([0, 0, 0, 1])])
    );
    let ui = ui1;
    for (let i = 0; i < iterations - 1; i++) {
        ui1 = hmacSha256(password, ui1);
        ui = xorBuffers(ui, ui1);
    }
    return ui;
}

export function sign(data: string, password: string, clientNonce: string): [string, string] {
    const m = Object.fromEntries(data.split(',').map(
        (attr) => [attr[0], attr.substring(2)])
    );

    if (!(m.i && m.r && m.s)) throw new Error("SASL message parse error");

    const nonce = m.r;

    if (!nonce.startsWith(clientNonce))
        throw new Error("SASL nonce mismatch");
    if (nonce.length === clientNonce.length)
        throw new Error("SASL nonce too short");

    const iterations = parseInt(m.i, 10);
    const salt = Buffer.from(m.s, 'base64');
    const saltedPassword = hi(password, salt, iterations)

    const clientKey = hmacSha256(saltedPassword, 'Client Key');
    const storedKey = sha256(clientKey);

    const clientFinalMessageWithoutProof = 'c=biws,r=' + nonce;
    const clientFirstMessageBare = 'n=*,r=' + clientNonce;
    const serverFirstMessage = data;

    const authMessage = (
        clientFirstMessageBare + ',' +
        serverFirstMessage + ',' +
        clientFinalMessageWithoutProof
    );

    const clientSignature = hmacSha256(storedKey, authMessage);
    const clientProofBytes = xorBuffers(clientKey, clientSignature);
    const clientProof = clientProofBytes.toString('base64');

    const serverKey = hmacSha256(saltedPassword, 'Server Key');
    const serverSignatureBytes = hmacSha256(serverKey, authMessage);

    const response = clientFinalMessageWithoutProof + ',p=' + clientProof;
    const serverSignature = serverSignatureBytes.toString('base64');
    return [response, serverSignature];
}

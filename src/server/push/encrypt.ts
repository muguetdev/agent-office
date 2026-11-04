// A Web Push message's body, encrypted for one browser (RFC 8291, `Content-Encoding: aes128gcm`, RFC
// 8188): an ECDH key of our own for this message only, agreed with the subscription's p256dh key, and
// its auth secret mixed in, so only that browser can read it. One record, of at most RECORD_SIZE bytes.
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export const RECORD_SIZE = 4096;
/** What a record adds to its plaintext: the padding delimiter and the GCM tag. */
const OVERHEAD = 1 + 16;
/** The most a payload can be, so the message fits in one record. */
export const MAX_PAYLOAD = RECORD_SIZE - OVERHEAD;

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, len: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, len));

/** The content key and nonce for a message, from the shared secret both ends work out. */
function keys(ecdhSecret: Buffer, auth: Buffer, uaPublic: Buffer, asPublic: Buffer, salt: Buffer) {
  const ikm = hkdf(auth, ecdhSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  return {
    cek: hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce: hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12),
  };
}

/**
 * `payload` encrypted for the browser whose subscription keys are `p256dh` (its uncompressed P-256
 * public key) and `auth` (its 16-byte secret), both base64url as PushSubscription.toJSON() gives them.
 */
export function encrypt(payload: Buffer | string, p256dh: string, auth: string, opts: { salt?: Buffer; ecdh?: ReturnType<typeof createECDH> } = {}): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  if (data.length > MAX_PAYLOAD) throw new Error(`push payload too big (${data.length} bytes)`);
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh key');
  if (authSecret.length < 16) throw new Error('bad auth secret');
  const ecdh = opts.ecdh ?? createECDH('prime256v1');
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = opts.salt ?? randomBytes(16);
  const { cek, nonce } = keys(ecdh.computeSecret(uaPublic), authSecret, uaPublic, asPublic, salt);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (and only) record ends with the 0x02 delimiter, and no padding after it.
  const body = Buffer.concat([cipher.update(data), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * What a browser does with a message: decrypts it with its own private key (`uaPrivate`, raw, and
 * its public key and auth secret, base64url). For the tests, which play the browser.
 */
export function decrypt(message: Buffer, uaPrivate: Buffer, p256dh: string, auth: string): Buffer {
  const salt = message.subarray(0, 16);
  const rs = message.readUInt32BE(16);
  const idLen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idLen);
  const record = message.subarray(21 + idLen);
  if (record.length > rs) throw new Error('more than one record');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const { cek, nonce } = keys(ecdh.computeSecret(asPublic), Buffer.from(auth, 'base64url'), uaPublic, asPublic, salt);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // Padding is zeros after the delimiter, from the end.
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('not the last record');
  return plain.subarray(0, end);
}

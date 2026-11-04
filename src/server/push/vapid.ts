// The office's VAPID key (RFC 8292): a P-256 key made once and kept in .agent-office/push-vapid.json
// (only the office's user may read it), whose public half every subscription is made with, and with
// which each push says it's from this office: an ES256 JWT for the push service's origin.
import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

interface Saved {
  /** The private key, as a JWK (its d, x and y). */
  jwk: { kty: 'EC'; crv: 'P-256'; d: string; x: string; y: string };
}

export class Vapid {
  private key: KeyObject;
  /** The uncompressed public key (0x04, x, y), base64url: applicationServerKey for the browsers. */
  readonly publicKey: string;
  /** A token for each push service's origin, made again before it runs out. */
  private tokens = new Map<string, { jwt: string; until: number }>();

  constructor(file: string) {
    let jwk: Saved['jwk'] | undefined;
    try {
      jwk = (JSON.parse(readFileSync(file, 'utf8')) as Saved).jwk;
    } catch {
      // none yet
    }
    if (!jwk?.d || !jwk.x || !jwk.y) {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      jwk = privateKey.export({ format: 'jwk' }) as Saved['jwk'];
      writeFileSync(file, JSON.stringify({ jwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y } } satisfies Saved), { mode: 0o600 });
    }
    this.key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y }, format: 'jwk' });
    this.publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  }

  /** The Authorization header for a push to `endpoint`, signed as `subject` (a mailto: or https: URL). */
  authorization(endpoint: string, subject: string, now = Date.now()): string {
    const aud = new URL(endpoint).origin;
    const cached = this.tokens.get(`${aud} ${subject}`);
    if (cached && cached.until > now) return `vapid t=${cached.jwt}, k=${this.publicKey}`;
    // Good for 12 hours (the most is 24), kept for 11.
    const exp = Math.floor(now / 1000) + 12 * 3600;
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp, sub: subject })}`;
    const sig = sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const jwt = `${unsigned}.${sig}`;
    this.tokens.set(`${aud} ${subject}`, { jwt, until: now + 11 * 3600_000 });
    return `vapid t=${jwt}, k=${this.publicKey}`;
  }
}

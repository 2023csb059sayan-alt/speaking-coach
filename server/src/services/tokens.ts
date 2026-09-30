import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../errors';
import { env } from '../env';

/**
 * Session tokens.
 *
 * Access token: a short-lived signed JWT kept in an httpOnly cookie.
 * Refresh token: an opaque 32-byte random value, stored only as a SHA-256 hash,
 * rotated on every use and tied to a family so reuse can be detected.
 *
 * No token is ever accepted from a URL query string, which keeps them out of logs
 * and out of the Referer header.
 */

export interface AccessClaims {
  userId: string;
  email: string;
  displayName: string;
  nativeLanguage: string;
}

const ISSUER = 'speaking-coach';

function accessKey(): Uint8Array {
  return new TextEncoder().encode(env().jwtAccessSecret);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const config = env();
  return new SignJWT({
    email: claims.email,
    name: claims.displayName,
    nativeLanguage: claims.nativeLanguage,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), { issuer: ISSUER });
    if (!payload.sub) throw new Error('missing subject');
    return {
      userId: payload.sub,
      email: typeof payload['email'] === 'string' ? payload['email'] : '',
      displayName: typeof payload['name'] === 'string' ? payload['name'] : '',
      nativeLanguage: typeof payload['nativeLanguage'] === 'string' ? payload['nativeLanguage'] : 'en',
    };
  } catch (error) {
    const expired = error instanceof Error && /expired/i.test(error.message);
    throw new AppError(expired ? 'token_expired' : 'token_invalid', { cause: error });
  }
}

/** Opaque refresh token. 32 random bytes, base64url encoded. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newFamilyId(): string {
  return randomBytes(16).toString('base64url');
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex. Used for refresh tokens, reset tokens and one-time links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(from: Date = new Date()): Date {
  const days = env().REFRESH_TOKEN_TTL_DAYS;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

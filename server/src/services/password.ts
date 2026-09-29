import argon2 from 'argon2';

/**
 * Password hashing.
 *
 * Argon2id with the memory-hard parameters from the OWASP password storage guide.
 * A dummy hash is verified when the account does not exist, so a wrong email takes
 * about as long as a wrong password and cannot be detected by timing.
 */

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHash: Promise<string> | null = null;

/**
 * A real Argon2id hash of a value nobody can log in with, computed once per process.
 * Verifying against it burns the same work as a real check, so "no such account"
 * and "wrong password" take about the same time and cannot be told apart by timing.
 */
function timingEqualizerHash(): Promise<string> {
  dummyHash ??= argon2.hash('not-a-real-password-timing-equalizer', ARGON_OPTIONS);
  return dummyHash;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash in the database must read as "wrong password", never crash.
    return false;
  }
}

/** Burns the same work as a real verification. Use when no account matched. */
export async function fakeVerify(plain: string): Promise<void> {
  try {
    await argon2.verify(await timingEqualizerHash(), plain);
  } catch {
    // The dummy password can never match, which is exactly the intent.
  }
}

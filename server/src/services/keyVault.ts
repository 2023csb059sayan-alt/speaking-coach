import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../errors';
import { env } from '../env';

/**
 * Bring-your-own-key encryption.
 *
 * A learner who has their own provider account can hand us the key and stay off the
 * shared free quota. The key is encrypted with AES-256-GCM before it reaches
 * MongoDB, using a server key that never leaves the server. The plaintext exists
 * only in memory for the duration of one upstream call and is never logged.
 */

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const key = env().byokEncryptionKey;
  if (!key) {
    throw new AppError('unsupported_capability', {
      message: 'Bring-your-own-key is switched off on this server.',
      context: { reason: 'BYOK_ENCRYPTION_KEY is not set' },
    });
  }
  return key;
}

export function isByokEnabled(): boolean {
  return env().BYOK_ENABLED;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new AppError('internal_error', { message: 'Stored key could not be read.' });
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new AppError('internal_error', {
      message: 'Stored key could not be read. It may have been entered before the server key changed.',
      cause: error,
    });
  }
}

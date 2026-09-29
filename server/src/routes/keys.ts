import { Router } from 'express';
import { byokProviderSchema } from '@speaking-coach/shared';
import { AppError } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { apiRateLimit } from '../middleware/security';
import { ProviderCredentialModel } from '../models';
import { allProviders, kindOfProviderId } from '../providers/registry';
import { decryptSecret, encryptSecret, isByokEnabled } from '../services/keyVault';
import { validationError } from '../services/accounts';
import { logger } from '../logging';

/**
 * Optional bring-your-own-key.
 *
 * A learner who already has a provider account can add the key here and stop using
 * the shared free allowance entirely. We store it encrypted, never return it, and
 * only decrypt it for the length of one upstream call.
 */

export const keysRouter = Router();

keysRouter.use(requireAuth, apiRateLimit);

keysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const credentials = await ProviderCredentialModel.find({ userId: req.auth!.userId }).lean();
    res.json({
      byokEnabled: isByokEnabled(),
      keys: credentials.map((credential) => ({
        providerId: credential.providerId,
        label: credential.label ?? '',
        addedAt: new Date(credential.createdAt ?? Date.now()).toISOString(),
        lastUsedAt: credential.lastUsedAt ? new Date(credential.lastUsedAt).toISOString() : null,
      })),
    });
  }),
);

keysRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!isByokEnabled()) {
      throw new AppError('unsupported_capability', {
        message: 'Bring-your-own-key is switched off on this server.',
      });
    }
    const parsed = byokProviderSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const providerId = parsed.data.providerId;
    const kind = kindOfProviderId(providerId);
    if (!kind) {
      throw new AppError('validation_failed', {
        message: 'That provider cannot be used with a personal key.',
        fields: { providerId: 'Unknown provider.' },
      });
    }

    const encryptedSecret = encryptSecret(parsed.data.apiKey);
    await ProviderCredentialModel.updateOne(
      { userId: req.auth!.userId, providerId },
      {
        $set: { encryptedSecret, label: parsed.data.label ?? '' },
      },
      { upsert: true },
    );
    logger.info({ userId: req.auth!.userId, providerId }, 'Learner added their own provider key');
    res.status(201).json({ providerId, stored: true });
  }),
);

keysRouter.delete(
  '/:providerId',
  asyncHandler(async (req, res) => {
    const providerId = req.params['providerId'] ?? '';
    if (!allProviders().some((provider) => provider.id === providerId)) {
      throw new AppError('not_found', { message: 'No key stored for that provider.' });
    }
    await ProviderCredentialModel.deleteOne({ userId: req.auth!.userId, providerId });
    res.json({ providerId, removed: true });
  }),
);

/** Used by the Quota Governor when a learner calls with their own key. */
export async function personalKeyFor(userId: string, providerId: string): Promise<string | undefined> {
  if (!isByokEnabled()) return undefined;
  const credential = await ProviderCredentialModel.findOne({ userId, providerId }).lean();
  if (!credential) return undefined;
  try {
    return decryptSecret(credential.encryptedSecret);
  } catch (error) {
    logger.warn({ userId, providerId, err: error }, 'Could not decrypt a stored provider key');
    return undefined;
  }
}

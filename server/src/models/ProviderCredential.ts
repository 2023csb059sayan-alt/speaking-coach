import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Optional bring-your-own-key.
 *
 * A learner who has their own provider account can add its key here instead of
 * sharing ours. The key is encrypted with AES-256-GCM before it touches MongoDB
 * and is decrypted only for the length of one upstream call. Nothing in the API
 * ever returns it, not even to the owner.
 */

const providerCredentialSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    providerId: { type: String, required: true },
    /** base64 of iv || authTag || ciphertext. */
    encryptedSecret: { type: String, required: true },
    label: { type: String, default: '', maxlength: 40 },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'providerCredentials' },
);

providerCredentialSchema.index({ userId: 1, providerId: 1 }, { unique: true });

export type ProviderCredentialDocument = InferSchemaType<typeof providerCredentialSchema>;

export const ProviderCredentialModel: Model<ProviderCredentialDocument> =
  (models['ProviderCredential'] as Model<ProviderCredentialDocument> | undefined) ??
  model<ProviderCredentialDocument>('ProviderCredential', providerCredentialSchema);

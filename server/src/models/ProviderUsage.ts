import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Daily usage ledger for the shared free quota.
 *
 * One row per provider per UTC day. The in-memory sliding window in the Quota
 * Governor is the fast path; this is the durable record that survives a restart
 * and the thing we look at before deciding how many learners we can serve.
 */

const providerUsageSchema = new Schema(
  {
    providerId: { type: String, required: true },
    kind: { type: String, required: true },
    dayKey: { type: String, required: true },
    requests: { type: Number, default: 0, min: 0 },
    inputTokens: { type: Number, default: 0, min: 0 },
    outputTokens: { type: Number, default: 0, min: 0 },
    characters: { type: Number, default: 0, min: 0 },
    audioSeconds: { type: Number, default: 0, min: 0 },
    neurons: { type: Number, default: 0, min: 0 },
    // `errors` is a reserved Mongoose path name, so the field is errorCount.
    errorCount: { type: Number, default: 0, min: 0 },
    quotaBlocks: { type: Number, default: 0, min: 0 },
    /** Last rate-limit headers the provider sent, so the dashboard can show reality. */
    lastRateLimitHeaders: { type: Map, of: String, default: undefined },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'providerUsage' },
);

providerUsageSchema.index({ providerId: 1, dayKey: 1 }, { unique: true });

export type ProviderUsageDocument = InferSchemaType<typeof providerUsageSchema>;

export const ProviderUsageModel: Model<ProviderUsageDocument> =
  (models['ProviderUsage'] as Model<ProviderUsageDocument> | undefined) ??
  model<ProviderUsageDocument>('ProviderUsage', providerUsageSchema);

import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Refresh sessions, one row per issued token.
 *
 * Rotation: presenting a token marks it revoked and issues a replacement in the
 * same family. Presenting an already-revoked token is treated as theft and
 * revokes the whole family, which forces a fresh sign-in.
 *
 * Only a SHA-256 hash of each token is stored, so a database leak does not hand
 * out sessions.
 */

const refreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['rotated', 'logout', 'reuse_detected', 'password_changed', 'expired'],
      default: null,
    },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: '', maxlength: 200 },
    ip: { type: String, default: '', maxlength: 64 },
  },
  { timestamps: true, collection: 'refreshSessions' },
);

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshSessionDocument = InferSchemaType<typeof refreshSessionSchema>;

export const RefreshSessionModel: Model<RefreshSessionDocument> =
  (models['RefreshSession'] as Model<RefreshSessionDocument> | undefined) ??
  model<RefreshSessionDocument>('RefreshSession', refreshSessionSchema);

import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/** One-time password reset tokens. Stored hashed, expired by a TTL index. */

const passwordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: '', maxlength: 64 },
  },
  { timestamps: true, collection: 'passwordResetTokens' },
);

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetTokenDocument = InferSchemaType<typeof passwordResetTokenSchema>;

export const PasswordResetTokenModel: Model<PasswordResetTokenDocument> =
  (models['PasswordResetToken'] as Model<PasswordResetTokenDocument> | undefined) ??
  model<PasswordResetTokenDocument>('PasswordResetToken', passwordResetTokenSchema);

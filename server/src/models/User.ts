import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';

/**
 * Accounts.
 *
 * Only the minimum is stored: an email, an Argon2id hash and a display name.
 * Transcripts and audio live in their own collections so that deleting a session
 * never touches credentials, and deleting an account never leaves orphans.
 */

const fairUseSchema = new Schema(
  {
    /** UTC day in YYYY-MM-DD form, so counters reset without a cron job. */
    dayKey: { type: String, default: '', maxlength: 10 },
    spokenSeconds: { type: Number, default: 0, min: 0 },
    interviewSpokenSeconds: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, maxlength: 200 },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastLoginAt: { type: Date, default: null },
    fairUse: { type: fairUseSchema, default: () => ({}) },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ createdAt: -1 });

export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel: Model<UserDocument> =
  (models['User'] as Model<UserDocument> | undefined) ?? model<UserDocument>('User', userSchema);

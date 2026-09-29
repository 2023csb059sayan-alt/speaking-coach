import { Schema, model, models, type Model, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LANGUAGES, SUPPORTED_SCRIPTS } from '@speaking-coach/shared';

/**
 * Learner preferences and consent.
 *
 * Consent is stored as an explicit timestamp so the privacy notice can honestly
 * claim when it was accepted. Audio storage stays off until a learner turns it on.
 */

const consentSchema = new Schema(
  {
    privacyNoticeAcceptedAt: { type: Date, default: null },
    microphoneGrantedAt: { type: Date, default: null },
    audioStorageGrantedAt: { type: Date, default: null },
  },
  { _id: false },
);

const profileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    nativeLanguage: { type: String, enum: SUPPORTED_LANGUAGES, default: 'en' },
    nativeLanguageScript: { type: String, enum: SUPPORTED_SCRIPTS, default: 'latin' },
    targetRole: { type: String, default: '', maxlength: 80 },
    targetDomain: { type: String, default: '', maxlength: 80 },
    /** Waits longer before ending a turn, for learners who pause to think. */
    confidenceMode: { type: Boolean, default: false },
    captionsAlwaysOn: { type: Boolean, default: true },
    onboardedAt: { type: Date, default: null },
    consent: { type: consentSchema, default: () => ({}) },
  },
  { timestamps: true, collection: 'userProfiles' },
);

// userId is already indexed by its own `unique: true`, so no extra index here.

export type UserProfileDocument = InferSchemaType<typeof profileSchema>;

export const UserProfileModel: Model<UserProfileDocument> =
  (models['UserProfile'] as Model<UserProfileDocument> | undefined) ??
  model<UserProfileDocument>('UserProfile', profileSchema);

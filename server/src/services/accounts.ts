import { registerSchema, type LoginInput, type RegisterInput } from '@speaking-coach/shared';
import { AppError } from '../errors';
import { env } from '../env';
import {
  PasswordResetTokenModel,
  RefreshSessionModel,
  UserModel,
  UserProfileModel,
} from '../models';
import { hashPassword, verifyPassword, fakeVerify } from './password';
import {
  hashToken,
  newFamilyId,
  newOpaqueToken,
  refreshExpiry,
} from './tokens';
import { sendPasswordResetEmail, type MailDelivery } from './mail';
import { logger } from '../logging';

/**
 * Account and session business logic.
 *
 * This lives in services, not in route handlers, so the same rules apply no matter
 * which entry point calls it. Routes only translate HTTP to these functions.
 */

export interface SessionContext {
  ip: string;
  userAgent: string;
}

export interface IssuedSession {
  refreshToken: string;
  familyId: string;
  expiresAt: Date;
}

export interface AccountView {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  profile: {
    nativeLanguage: string;
    nativeLanguageScript: string;
    targetRole: string;
    targetDomain: string;
    confidenceMode: boolean;
    captionsAlwaysOn: boolean;
    onboardedAt: string | null;
  } | null;
}

export async function registerUser(input: RegisterInput): Promise<AccountView> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);

  const data = parsed.data;
  const existing = await UserModel.findOne({ email: data.email }).lean();
  if (existing) {
    throw new AppError('email_taken');
  }

  const passwordHash = await hashPassword(data.password);
  const user = await UserModel.create({
    email: data.email,
    passwordHash,
    displayName: data.displayName ?? data.email.split('@')[0] ?? 'Learner',
    fairUse: { dayKey: '', spokenSeconds: 0, interviewSpokenSeconds: 0 },
  });

  await UserProfileModel.create({
    userId: user._id,
    nativeLanguage: data.nativeLanguage,
    nativeLanguageScript: 'latin',
    captionsAlwaysOn: true,
    consent: { privacyNoticeAcceptedAt: new Date() },
  });

  logger.info({ userId: user._id.toString() }, 'Account created');
  return toAccountView(user.toObject());
}

export async function authenticate(input: LoginInput): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const user = await UserModel.findOne({ email });
  if (!user) {
    // Spend the same time as a real verification so the response time does not
    // reveal whether the address exists.
    await fakeVerify(input.password);
    throw new AppError('invalid_credentials');
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw new AppError('invalid_credentials');
  if (user.status !== 'active') {
    throw new AppError('forbidden', { message: 'This account is not active. Please contact support.' });
  }
  user.lastLoginAt = new Date();
  await user.save();
  return { userId: user._id.toString() };
}

export async function issueSession(
  userId: string,
  context: SessionContext,
  familyId = newFamilyId(),
): Promise<IssuedSession> {
  const refreshToken = newOpaqueToken();
  const expiresAt = refreshExpiry();
  await RefreshSessionModel.create({
    userId,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent: context.userAgent.slice(0, 200),
    ip: context.ip.slice(0, 64),
  });
  return { refreshToken, familyId, expiresAt };
}

/**
 * Rotate a refresh token.
 *
 * Presenting a token that was already used is treated as theft: the whole family is
 * revoked and the caller has to sign in again. That is the only way to stop a
 * stolen token from being used twice without the real owner noticing.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  context: SessionContext,
): Promise<{ userId: string; session: IssuedSession }> {
  const tokenHash = hashToken(refreshToken);
  const existing = await RefreshSessionModel.findOne({ tokenHash });
  if (!existing) throw new AppError('token_invalid');

  if (existing.revokedAt) {
    await revokeFamily(existing.familyId, 'reuse_detected');
    logger.warn({ familyId: existing.familyId }, 'Refresh token reuse detected; family revoked');
    throw new AppError('token_invalid', {
      message: 'That session was already used, so we signed it out. Please sign in again.',
    });
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    existing.revokedAt = new Date();
    existing.revokedReason = 'expired';
    await existing.save();
    throw new AppError('token_expired');
  }

  const user = await UserModel.findById(existing.userId).lean();
  if (!user || user.status !== 'active') throw new AppError('unauthorized');

  const session = await issueSession(user._id.toString(), context, existing.familyId);
  existing.revokedAt = new Date();
  existing.revokedReason = 'rotated';
  existing.replacedByHash = hashToken(session.refreshToken);
  await existing.save();

  return { userId: user._id.toString(), session };
}

export async function revokeSessionByToken(refreshToken: string, reason: 'logout'): Promise<void> {
  const existing = await RefreshSessionModel.findOne({ tokenHash: hashToken(refreshToken) });
  if (!existing || existing.revokedAt) return;
  existing.revokedAt = new Date();
  existing.revokedReason = reason;
  await existing.save();
}

export async function revokeAllSessions(userId: string, reason: 'password_changed'): Promise<void> {
  await RefreshSessionModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

async function revokeFamily(familyId: string, reason: 'reuse_detected'): Promise<void> {
  await RefreshSessionModel.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function requestPasswordReset(email: string, ip: string): Promise<MailDelivery> {
  const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).lean();
  // Always answer the same way so the endpoint cannot be used to discover accounts.
  if (!user) return { sent: true };

  const token = newOpaqueToken(32);
  const expiresAt = new Date(Date.now() + env().RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  await PasswordResetTokenModel.create({
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt,
    requestedIp: ip.slice(0, 64),
  });

  const resetUrl = `${env().API_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendPasswordResetEmail(user.email, resetUrl);
}

export async function completePasswordReset(token: string, newPassword: string): Promise<void> {
  const record = await PasswordResetTokenModel.findOne({ tokenHash: hashToken(token) });
  if (!record) throw new AppError('token_invalid');
  if (record.usedAt) throw new AppError('token_invalid', { message: 'This link has already been used.' });
  if (record.expiresAt.getTime() <= Date.now()) throw new AppError('token_expired');

  const passwordHash = await hashPassword(newPassword);
  await UserModel.updateOne({ _id: record.userId }, { $set: { passwordHash } });
  record.usedAt = new Date();
  await record.save();
  await revokeAllSessions(record.userId.toString(), 'password_changed');
  logger.info({ userId: record.userId.toString() }, 'Password reset completed');
}

interface UserLike {
  _id: unknown;
  email: string;
  displayName: string;
  createdAt?: Date;
}

export async function accountView(userId: string): Promise<AccountView | null> {
  const user = await UserModel.findById(userId).lean();
  if (!user) return null;
  return toAccountView(user);
}

function toAccountView(user: UserLike): AccountView {
  return {
    userId: String(user._id),
    email: user.email,
    displayName: user.displayName,
    createdAt: (user.createdAt ?? new Date()).toISOString(),
    profile: null,
  };
}

/** Account view with the profile attached, used by GET /auth/me. */
export async function fullAccountView(userId: string): Promise<AccountView | null> {
  const view = await accountView(userId);
  if (!view) return null;
  const profile = await UserProfileModel.findOne({ userId: view.userId }).lean();
  return {
    ...view,
    profile: profile
      ? {
          nativeLanguage: profile.nativeLanguage,
          nativeLanguageScript: profile.nativeLanguageScript,
          targetRole: profile.targetRole,
          targetDomain: profile.targetDomain,
          confidenceMode: profile.confidenceMode,
          captionsAlwaysOn: profile.captionsAlwaysOn,
          onboardedAt: profile.onboardedAt ? new Date(profile.onboardedAt).toISOString() : null,
        }
      : null,
  };
}

export async function updateProfile(userId: string, updates: Record<string, unknown>): Promise<AccountView> {
  await UserProfileModel.updateOne({ userId }, { $set: updates }, { upsert: true });
  if (typeof updates['displayName'] === 'string') {
    await UserModel.updateOne({ _id: userId }, { $set: { displayName: updates['displayName'] } });
  }
  const view = await fullAccountView(userId);
  if (!view) throw new AppError('not_found');
  return view;
}

/** Turns a Zod failure into a 422 with per-field messages the form can show. */
export function validationError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return new AppError('validation_failed', {
    message: 'Please check the highlighted fields.',
    fields,
  });
}

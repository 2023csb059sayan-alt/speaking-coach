import { Router } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@speaking-coach/shared';
import { AppError } from '../errors';
import { env } from '../env';
import { asyncHandler } from '../middleware/asyncHandler';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { authRateLimit } from '../middleware/security';
import {
  authenticate,
  completePasswordReset,
  fullAccountView,
  issueSession,
  registerUser,
  requestPasswordReset,
  revokeSessionByToken,
  rotateRefreshToken,
  updateProfile,
  validationError,
} from '../services/accounts';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from '../services/cookies';
import { signAccessToken } from '../services/tokens';
import { UserModel } from '../models';
import { logger } from '../logging';

/**
 * Authentication routes.
 *
 * Tokens are set as httpOnly cookies and never returned in the response body, so
 * there is nothing for client-side JavaScript to read or leak.
 */

export const authRouter = Router();

function sessionContext(req: { ip?: string; header(name: string): string | undefined }): {
  ip: string;
  userAgent: string;
} {
  return {
    ip: req.ip ?? 'unknown',
    userAgent: req.header('user-agent') ?? 'unknown',
  };
}

authRouter.post(
  '/register',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const account = await registerUser(parsed.data);
    const session = await issueSession(account.userId, sessionContext(req));
    const accessToken = await signAccessToken({
      userId: account.userId,
      email: account.email,
      displayName: account.displayName,
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, session.refreshToken, session.expiresAt);
    res.status(201).json({ account });
  }),
);

authRouter.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const { userId } = await authenticate(parsed.data);
    const user = await UserModel.findById(userId).lean();
    if (!user) throw new AppError('unauthorized');

    const session = await issueSession(userId, sessionContext(req));
    const accessToken = await signAccessToken({
      userId,
      email: user.email,
      displayName: user.displayName,
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, session.refreshToken, session.expiresAt);
    const account = await fullAccountView(userId);
    res.json({ account });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw new AppError('token_invalid', { message: 'No session cookie found.' });

    const { userId, session } = await rotateRefreshToken(refreshToken, sessionContext(req));
    const user = await UserModel.findById(userId).lean();
    if (!user) throw new AppError('unauthorized');

    const accessToken = await signAccessToken({
      userId,
      email: user.email,
      displayName: user.displayName,
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, session.refreshToken, session.expiresAt);
    res.json({ account: await fullAccountView(userId) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_COOKIE];
    if (refreshToken) await revokeSessionByToken(refreshToken, 'logout');
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.json({ account: null });
      return;
    }
    const account = await fullAccountView(req.auth.userId);
    if (!account) {
      clearAuthCookies(res);
      res.json({ account: null });
      return;
    }
    res.json({ account });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const account = await updateProfile(req.auth!.userId, parsed.data);
    res.json({ account });
  }),
);

authRouter.post(
  '/forgot-password',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const delivery = await requestPasswordReset(parsed.data.email, req.ip ?? 'unknown');
    const response: { ok: true; delivery: string; devResetUrl?: string } = {
      ok: true,
      delivery: delivery.sent ? 'sent' : (delivery.reason ?? 'not_sent'),
      ...(delivery.devResetUrl && env().NODE_ENV !== 'production' ? { devResetUrl: delivery.devResetUrl } : {}),
    };
    if (!delivery.sent && delivery.reason === 'not_configured' && env().NODE_ENV === 'production') {
      // Do not pretend: the operator needs to know email is not set up.
      throw new AppError('provider_unavailable', {
        message: 'Email is not configured on this server, so we cannot send reset links yet.',
      });
    }
    logger.info({ delivery: response.delivery }, 'Password reset requested');
    res.json(response);
  }),
);

authRouter.post(
  '/reset-password',
  authRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    await completePasswordReset(parsed.data.token, parsed.data.password);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

export { ACCESS_COOKIE, REFRESH_COOKIE };

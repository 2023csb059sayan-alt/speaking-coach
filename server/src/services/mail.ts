import { env } from '../env';
import { logger } from '../logging';

/**
 * Transactional email through Resend's free tier.
 *
 * Free plan (verified 2026-09-30, https://resend.com/pricing): 3,000 emails a
 * month, 100 a day, 3 domains. That is plenty for password resets at our scale and
 * costs nothing.
 *
 * When no key is configured we say so instead of pretending an email was sent. The
 * caller decides what to show; in development it includes a direct reset link so
 * the flow can be tested without an inbox.
 */

export interface MailDelivery {
  sent: boolean;
  reason?: 'not_configured' | 'rejected' | 'failed';
  devResetUrl?: string;
}

interface ResendResponse {
  id?: string;
  message?: string;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<MailDelivery> {
  const config = env();
  if (!config.RESEND_API_KEY) {
    logger.warn({ hasKey: false }, 'Password reset requested but email is not configured');
    return config.NODE_ENV === 'production'
      ? { sent: false, reason: 'not_configured' }
      : { sent: false, reason: 'not_configured', devResetUrl: resetUrl };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.MAIL_FROM,
        to: [to],
        subject: 'Reset your Speaking Coach password',
        text: [
          'Someone asked to reset the password for this account.',
          '',
          `Open this link to choose a new one: ${resetUrl}`,
          '',
          'The link expires in ' + config.RESET_TOKEN_TTL_MINUTES + ' minutes.',
          'If this was not you, you can ignore this email. Nothing has changed.',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ResendResponse;
      logger.warn({ status: response.status, providerMessage: body.message }, 'Resend rejected the email');
      return { sent: false, reason: response.status >= 500 ? 'failed' : 'rejected' };
    }
    return { sent: true };
  } catch (error) {
    logger.warn({ err: error }, 'Could not reach the email provider');
    return { sent: false, reason: 'failed' };
  }
}

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@speaking-coach/shared';
import { useState } from 'react';
import { api, ApiError, type Account } from '../lib/api';
import { Notice } from './Primitives';

/**
 * Sign in / create account.
 *
 * Rules this screen follows:
 *   - it never claims a feature is locked or asks for a card, because there is
 *     nothing to unlock and nothing to pay;
 *   - it says the same thing whether the account exists or not, so the form
 *     cannot be used to discover who has an account;
 *   - validation messages come from the API, not from a second copy of the rules
 *     here, so the two cannot drift apart.
 */

type Mode = 'login' | 'register' | 'forgot';

export function AuthCard({ onAuthenticated }: { onAuthenticated: (account: Account) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState<SupportedLanguage>('en');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  function resetFeedback(): void {
    setError(null);
    setFieldErrors({});
    setMessage(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      if (mode === 'login') {
        const { account } = await api.login({ email: email.trim(), password });
        onAuthenticated(account);
        return;
      }
      if (mode === 'register') {
        const { account } = await api.register({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
          nativeLanguage,
          acceptedTerms: true,
        });
        onAuthenticated(account);
        return;
      }
      const result = await api.forgotPassword(email.trim());
      setMessage(
        result.devResetUrl
          ? `Email is not configured in development, so here is the reset link: ${result.devResetUrl}`
          : 'If that email has an account, a reset link is on its way. It expires in one hour.',
      );
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.fields) setFieldErrors(caught.fields);
      } else {
        setError('We could not reach the server. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <header className="mb-8 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-accent-400">Speaking Coach</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">
          Practice English out loud, and get ready for interviews.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Free to use, with no trial and nothing held back. You decide how much time you spend.
        </p>
      </header>

      <div className="card p-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-900/60 p-1">
          {(['login', 'register'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                resetFeedback();
              }}
              aria-pressed={mode === option}
              className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                mode === option ? 'bg-accent-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {option === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="field"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors['email'])}
              aria-describedby={fieldErrors['email'] ? 'email-error' : undefined}
              required
            />
            {fieldErrors['email'] && (
              <p id="email-error" className="mt-1.5 text-sm text-rose-300">
                {fieldErrors['email']}
              </p>
            )}
          </div>

          {mode === 'register' && (
            <>
              <div>
                <label className="label" htmlFor="displayName">
                  What should we call you?{' '}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  id="displayName"
                  className="field"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="nativeLanguage">
                  Which language do you think in?
                </label>
                <select
                  id="nativeLanguage"
                  className="field"
                  value={nativeLanguage}
                  onChange={(event) => setNativeLanguage(event.target.value as SupportedLanguage)}
                >
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_LABELS[code]}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  Used only for the optional “explain in my language” toggle. Your corrected English is always in
                  English.
                </p>
              </div>
            </>
          )}

          {mode !== 'forgot' && (
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors['password'])}
                aria-describedby={fieldErrors['password'] ? 'password-error' : 'password-hint'}
                required
              />
              {fieldErrors['password'] ? (
                <p id="password-error" className="mt-1.5 text-sm text-rose-300">
                  {fieldErrors['password']}
                </p>
              ) : (
                mode === 'register' && (
                  <p id="password-hint" className="mt-1.5 text-xs text-slate-500">
                    At least 10 characters, with a few words rather than a pattern.
                  </p>
                )
              )}
            </div>
          )}

          {mode === 'register' && (
            <label className="flex items-start gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 bg-surface-900 accent-accent-500"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
              />
              <span>
                I understand the <span className="text-slate-100">privacy notice</span>: my voice is only recorded
                while I hold the button, and I can delete everything at any time.
              </span>
            </label>
          )}

          {error && <Notice tone="bad">{error}</Notice>}
          {message && <Notice tone="ok">{message}</Notice>}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={busy || (mode === 'register' && !acceptedTerms)}
          >
            {busy
              ? 'One moment…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create my account'
                  : 'Send reset link'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            className="min-h-[44px] text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
            onClick={() => {
              setMode(mode === 'forgot' ? 'login' : 'forgot');
              resetFeedback();
            }}
          >
            {mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}
          </button>
          <span className="text-slate-600">No card required</span>
        </div>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
        Pronunciation scoring is not switched on, because no free provider offers it. Where a score would appear we
        say “not assessed” rather than invent a number.
      </p>
    </div>
  );
}

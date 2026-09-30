import { useState } from 'react';
import type { Account } from './lib/api';
import { useSession } from './hooks/useSession';
import { AuthCard } from './components/AuthCard';
import { TransparencyPanel } from './components/TransparencyPanel';
import { ConversationScreen } from './components/ConversationScreen';
import { Badge, Card, Notice } from './components/Primitives';
import { LANGUAGE_LABELS, type SupportedLanguage } from '@speaking-coach/shared';

/**
 * App shell.
 *
 * Phase 1 scope: a working session (sign in, sign out) and an honest look at the
 * free-tier plumbing. The practice screen itself arrives in Phase 2, so nothing
 * here is a placeholder pretending to be a feature: what you can tap, you can use.
 */

type Tab = 'home' | 'transparency' | 'conversation';

export function App() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const [signingOut, setSigningOut] = useState(false);

  if (session.loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-slate-400">Checking your session…</p>
      </main>
    );
  }

  if (!session.account) {
    return (
      <main className="min-h-dvh">
        <AuthCard onAuthenticated={session.signIn} />
      </main>
    );
  }

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await session.signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-surface-900/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm font-semibold tracking-tight text-slate-100">Speaking Coach</p>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-400 sm:inline">{session.account?.displayName}</span>
            <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <nav className="mx-auto mt-4 grid max-w-3xl grid-cols-2 gap-1 px-5" aria-label="Sections">
        {(
          [
            ['home', 'Home'],
            ['transparency', 'Free tier & limits'],
            ['conversation', 'Conversation'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? 'page' : undefined}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
              tab === value ? 'bg-white/10 text-slate-50' : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-5">
        {tab === 'home' ? <HomeScreen account={session.account} /> : ''}
        {tab === 'transparency' ? <TransparencyPanel /> : ''}
        {tab === 'conversation' && session.account ? <ConversationScreen /> : <Notice tone="neutral">Sign in to start a conversation.</Notice>}

        <footer className="pb-10 pt-4 text-center text-xs leading-relaxed text-slate-600">
          Your recordings are processed only while you practise and are deleted on request. Nothing here is sold, and
          no feature is locked.
        </footer>
      </main>
    </div>
  );
}

function HomeScreen({ account }: { account: Account | null }) {
  if (!account) return null;
  const language = (account.profile?.nativeLanguage ?? 'en') as SupportedLanguage;

  return (
    <>
      <Card
        title={`Welcome, ${account.displayName}`}
        subtitle="Your account is ready. The voice conversation screen is the next build step."
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="text-sm text-slate-200">{account.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Thinking language</dt>
            <dd className="text-sm text-slate-200">{LANGUAGE_LABELS[language]}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Captions</dt>
            <dd className="text-sm text-slate-200">
              {account.profile?.captionsAlwaysOn ? 'Always on' : 'Following your device setting'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Confidence mode</dt>
            <dd className="text-sm text-slate-200">
              {account.profile?.confidenceMode ? 'On (more patient turn-taking)' : 'Off'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="What is built so far" subtitle="Phase 1 of six. Each line below works today, not as a mock-up.">
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex items-start gap-2">
            <Badge tone="ok">done</Badge>
            Account creation, sign in, session refresh and sign out, with hashed passwords.
          </li>
          <li className="flex items-start gap-2">
            <Badge tone="ok">done</Badge>
            A free-tier quota governor that tracks real provider limits and fails over between providers.
          </li>
          <li className="flex items-start gap-2">
            <Badge tone="ok">done</Badge>
            Optional bring-your-own-key storage, encrypted at rest and never returned by the API.
          </li>
          <li className="flex items-start gap-2">
            <Badge tone="warn">next</Badge>
            The live conversation screen: hold to speak, on-device transcription where possible, streamed replies.
          </li>
        </ul>
      </Card>

      <Notice tone="neutral">
        Pronunciation scoring shows “not assessed” today, and will keep doing so until a genuinely free provider
        exists. Your accent is never marked wrong; we only report what we can actually measure.
      </Notice>
    </>
  );
}

import { useEffect, useState } from 'react';
import { api, describeLimit, type BudgetResponse, type ProviderHealthView, type ProvidersResponse } from '../lib/api';
import { Badge, Card, Meter, Notice, Skeleton } from './Primitives';

/**
 * Free-tier transparency panel.
 *
 * This screen exists so "free forever" is a number the learner can look at rather
 * than a claim they have to trust. It shows the real configured limits from the
 * server, how much of today's allowance is used, and which provider each job falls
 * back to. Nothing here is hardcoded: every figure comes from `/api/health/*`.
 */

const KIND_LABEL: Record<string, string> = {
  stt: 'Speech to text (hearing you)',
  tts: 'Text to speech (coach voice)',
  llm: 'Language model (the conversation)',
  pronunciation: 'Pronunciation scoring',
};

function statusTone(status: ProviderHealthView['status']): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'unconfigured':
      return 'neutral';
    case 'limited':
      return 'warn';
    case 'unreachable':
    case 'rejected':
      return 'bad';
    default:
      return 'neutral';
  }
}

function ProviderRow({ provider }: { provider: ProviderHealthView }) {
  return (
    <li className="rounded-xl border border-white/10 bg-surface-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-slate-100">{provider.id}</span>
          {provider.chainPosition >= 0 && <Badge tone="accent">chain position {provider.chainPosition + 1}</Badge>}
        </div>
        <Badge tone={statusTone(provider.status)}>
          {provider.status}
          {provider.latencyMs !== null && ` · ${provider.latencyMs} ms`}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-slate-400">{provider.detail}</p>

      {provider.capabilities && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {provider.capabilities.onDevice && <Badge tone="ok">on device</Badge>}
          {provider.capabilities.wordTimestamps && <Badge>word timings</Badge>}
          {provider.capabilities.streaming && <Badge>streaming</Badge>}
          {provider.capabilities.pronunciationScoring && <Badge tone="accent">pronunciation scores</Badge>}
          {!provider.capabilities.wordTimestamps && !provider.capabilities.pronunciationScoring && (
            <Badge>no word timings</Badge>
          )}
        </ul>
      )}

      {provider.freeTier && (
        <div className="mt-3">
          <p className="text-xs text-slate-500">
            {provider.freeTier.plan}
            {provider.freeTier.requiresCard && ' · needs a card, so it is not on the default chain'} · verified{' '}
            {provider.freeTier.verifiedOn}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-slate-400">
            {provider.freeTier.limits.map((limit) => (
              <li key={`${limit.unit}-${limit.window}`}>
                {limit.unlimited ? 'unlimited' : limit.limit.toLocaleString('en-IN')}{' '}
                {describeLimit(limit.unit, limit.window)}
              </li>
            ))}
          </ul>
          {provider.documentation.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {provider.documentation.map((doc) => (
                <a
                  key={doc.url}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent-400 underline-offset-4 hover:underline"
                >
                  {doc.title}
                </a>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function TransparencyPanel() {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const [providerData, budgetData] = await Promise.all([api.providers(), api.budget()]);
        if (!active) return;
        setProviders(providerData);
        setBudget(budgetData);
      } catch {
        if (active) setError('We could not load the provider and budget report just now.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !providers || !budget) {
    return <Notice tone="bad">{error ?? 'The report is unavailable.'}</Notice>;
  }

  const missing = providers.providers.filter((provider) => !provider.configured);
  const unavailableKinds = (Object.entries(providers.chains) as [string, string[]][]).filter(
    ([, chain]) => chain.length === 0,
  );

  return (
    <div className="space-y-5">
      <Card
        title="Where this runs on"
        subtitle={`Checked ${new Date(providers.checkedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Each job tries the first configured provider and falls back automatically.`}
      >
        <ul className="space-y-2">
          {Object.entries(KIND_LABEL).map(([kind, label]) => {
            const chain = providers.chains[kind as keyof typeof providers.chains] ?? [];
            return (
              <li key={kind} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-44 shrink-0 text-sm text-slate-300">{label}</span>
                {chain.length === 0 ? (
                  <span className="text-sm text-amber-300">No provider configured yet</span>
                ) : (
                  <span className="text-sm text-slate-100">
                    {chain.map((id, index) => (
                      <span key={id}>
                        {index > 0 && <span className="px-1.5 text-slate-600">then</span>}
                        {id}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-sm text-amber-200">
            Pronunciation: <span className="font-semibold">{providers.pronunciation.uiLabel}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{providers.pronunciation.reason}</p>
        </div>
      </Card>

      <Card title="Today’s shared allowance" subtitle={`Usage day ${budget.dayKey} (UTC). Our own ledger, not the provider’s.`}>
        <ul className="space-y-3">
          {budget.providers
            .filter((provider) => provider.limits.length > 0)
            .map((provider) => (
              <li key={provider.providerId}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-mono text-slate-100">{provider.providerId}</span>
                  <span className="text-slate-400">
                    {provider.limits
                      .map((limit) => `${limit.used.toLocaleString('en-IN')}/${limit.limit.toLocaleString('en-IN')}`)
                      .join(' · ')}
                  </span>
                </div>
                {provider.limits.map((limit) => (
                  <div key={`${limit.unit}-${limit.window}`} className="mb-2">
                    <Meter percentUsed={limit.percentUsed} exhausted={limit.exhausted} />
                    <p className="mt-1 text-xs text-slate-500">
                      {describeLimit(limit.unit, limit.window)} · {limit.remaining.toLocaleString('en-IN')} left
                    </p>
                  </div>
                ))}
                {provider.breaker.state !== 'closed' && (
                  <p className="mt-1 text-xs text-amber-300">
                    Circuit is {provider.breaker.state}; traffic is going to the next provider.
                  </p>
                )}
              </li>
            ))}
        </ul>

        <p className="mt-4 text-sm leading-relaxed text-slate-400">{budget.notes.headline}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{budget.notes.honesty}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {budget.notes.growthPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </Card>

      {unavailableKinds.length > 0 && (
        <Notice tone="warn">
          Practice is not ready yet: {unavailableKinds.map(([kind]) => KIND_LABEL[kind]?.toLowerCase() ?? kind).join(', ')}{' '}
          {unavailableKinds.length === 1 ? 'has' : 'have'} no provider configured. Add a key to the server environment
          and this fills in without a code change.
        </Notice>
      )}

      {missing.length > 0 && (
        <Notice tone="neutral">
          {missing.length} optional {missing.length === 1 ? 'provider is' : 'providers are'} not configured. Missing
          ones are simply skipped, never faked.
        </Notice>
      )}

      <Card title="Every provider we know about" subtitle="Including the ones not switched on, with the official page each number came from.">
        <ul className="space-y-3">
          {providers.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

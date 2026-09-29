import { describe, expect, it } from 'vitest';
import { FREE_TIERS, PROVIDER_DOC_LINKS, freeQuotaFor } from '../src/config/freeTiers';
import { PROVIDER_IDS } from '../src/config/providerIds';
import { allProviders, configuredChainIds } from '../src/providers/registry';
import { EnvError, loadEnv } from '../src/env';
import { PRONUNCIATION_ASSESSMENT_STATUS, SCI_FORMULA, IRS_FORMULA } from '@speaking-coach/shared';

/**
 * These tests are the guard rail for the whole product promise.
 *
 * If someone adds a provider without documenting its free tier, or puts a
 * card-required provider in a default chain, the suite goes red. That is
 * deliberate: "free forever" has to be enforced by something, not just written
 * down in a README.
 */

describe('free tier documentation', () => {
  it('records an official source and a verification date for every provider', () => {
    for (const id of PROVIDER_IDS) {
      const quota = freeQuotaFor(id);
      expect(quota, `${id} has no entry in FREE_TIERS`).not.toBeNull();
      expect(quota!.source, `${id} has no source URL`).toMatch(/^https:\/\//);
      expect(quota!.source, `${id} must link to the provider's own docs`).not.toMatch(/medium\.com|dev\.to|reddit/);
      expect(quota!.verifiedOn, `${id} has no verification date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never marks a card-required provider as part of a default chain', () => {
    const cardRequired = Object.entries(FREE_TIERS)
      .filter(([, quota]) => quota.requiresCard)
      .map(([id]) => id);
    expect(cardRequired.length).toBeGreaterThan(0);

    const defaults = ['stt', 'tts', 'llm'].flatMap((kind) => configuredChainIds(kind as 'stt'));
    for (const id of defaults) {
      expect(cardRequired, `${id} requires a card but is in a default chain`).not.toContain(id);
    }
  });

  it('only puts providers with real free allowances in a default chain', () => {
    for (const id of configuredChainIds('llm')) {
      const quota = freeQuotaFor(id);
      expect(quota, `${id} has no free tier record`).not.toBeNull();
      expect(quota!.requiresCard).toBe(false);
    }
  });

  it('gives every registered provider a capability descriptor', () => {
    for (const provider of allProviders()) {
      expect(provider.capabilities.id).toBe(provider.id);
      expect(provider.capabilities.kind).toBe(provider.kind);
      expect(provider.capabilities.description.length).toBeGreaterThan(10);
      // A provider either has a documented free tier or says it is local.
      if (provider.id.startsWith('ollama')) {
        expect(provider.capabilities.freeQuota).not.toBeNull();
      }
    }
  });

  it('exposes official documentation links for the providers we ship', () => {
    for (const id of ['groq-llm', 'groq-stt', 'workersai-llm', 'workersai-stt']) {
      expect(PROVIDER_DOC_LINKS[id], `${id} has no documentation links`).toBeDefined();
      for (const link of PROVIDER_DOC_LINKS[id]!) {
        expect(link.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('admits that Gemini publishes no numeric free limits', () => {
    expect(FREE_TIERS['gemini-llm'].limits).toEqual([]);
    expect(FREE_TIERS['gemini-llm'].notes).toMatch(/not published|no numeric|AI Studio/i);
    expect(configuredChainIds('llm')).not.toContain('gemini-llm');
  });

  it('states plainly that pronunciation is not scored', () => {
    expect(PRONUNCIATION_ASSESSMENT_STATUS.available).toBe(false);
    expect(PRONUNCIATION_ASSESSMENT_STATUS.uiLabel).toBe('Not assessed');
  });
});

describe('scoring formulas', () => {
  it('uses versioned identifiers so a report can be traced to its formula', () => {
    expect(SCI_FORMULA.id).toBe('SCI-v1.0.0');
    expect(IRS_FORMULA.id).toBe('IRS-v1.0.0');
  });

  it('has weights that add up to one', () => {
    const sciTotal = Object.values(SCI_FORMULA.components).reduce((sum, weight) => sum + weight, 0);
    const irsTotal = Object.values(IRS_FORMULA.components).reduce((sum, weight) => sum + weight, 0);
    expect(sciTotal).toBeCloseTo(1, 5);
    expect(irsTotal).toBeCloseTo(1, 5);
  });

  it('refuses to show interview readiness before there is enough evidence', () => {
    expect(IRS_FORMULA.minScoredAnswers).toBeGreaterThanOrEqual(5);
  });
});

describe('environment validation', () => {
  const base = { ...process.env } as NodeJS.ProcessEnv;

  it('accepts a minimal development environment', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' });
    expect(env.PORT).toBe(8080);
    expect(env.CHAIN_LLM.length).toBeGreaterThan(0);
  });

  it('treats a blank value as not configured, so a copied .env starts cleanly', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'development',
      GROQ_API_KEY: '',
      RESEND_API_KEY: '   ',
      JWT_ACCESS_SECRET: '',
      JWT_REFRESH_SECRET: '',
      BYOK_ENCRYPTION_KEY: '',
      OLLAMA_BASE_URL: '',
    });
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.OLLAMA_BASE_URL).toBeUndefined();
    expect(env.ephemeralSecrets).toBe(true);
    expect(env.byokEncryptionKey).toBeNull();
  });

  it('trims a pasted key so a trailing space does not break the provider call', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development', GROQ_API_KEY: '  gsk-example-key  ' });
    expect(env.GROQ_API_KEY).toBe('gsk-example-key');
  });

  it('refuses a chain that names a provider we do not have', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', CHAIN_LLM: 'made-up-provider' })).toThrow(EnvError);
  });

  it('refuses the same provider twice in one chain', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', CHAIN_LLM: 'groq-llm,groq-llm' }),
    ).toThrow(/twice/i);
  });

  it('requires both signing secrets in production', () => {
    const production: NodeJS.ProcessEnv = { ...base, NODE_ENV: 'production' };
    delete production['JWT_ACCESS_SECRET'];
    delete production['JWT_REFRESH_SECRET'];
    expect(() => loadEnv(production)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses to start in production with no provider credentials at all', () => {
    const env = {
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      JWT_REFRESH_SECRET: 'y'.repeat(48),
      GROQ_API_KEY: undefined,
      CLOUDFLARE_AI_TOKEN: undefined,
      CLOUDFLARE_ACCOUNT_ID: undefined,
      GEMINI_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
      AZURE_SPEECH_KEY: undefined,
      OLLAMA_BASE_URL: undefined,
    } as NodeJS.ProcessEnv;
    expect(() => loadEnv(env)).toThrow(/No provider credentials/);
  });

  it('generates throwaway secrets in development and says so', () => {
    const development: NodeJS.ProcessEnv = { ...base, NODE_ENV: 'development' };
    delete development['JWT_ACCESS_SECRET'];
    delete development['JWT_REFRESH_SECRET'];
    const env = loadEnv(development);
    expect(env.generatedSecretNames).toContain('JWT_ACCESS_SECRET');
    expect(env.ephemeralSecrets).toBe(true);
    expect(env.jwtAccessSecret).not.toBe(env.jwtRefreshSecret);
  });

  it('refuses SameSite=None outside production, where it could not work', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', COOKIE_SAMESITE: 'none' })).toThrow(
      /SameSite=None/i,
    );
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', BYOK_ENABLED: 'true', BYOK_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/BYOK_ENCRYPTION_KEY/);
  });
});

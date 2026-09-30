import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app';

/**
 * The health surface an operator (and a free host's uptime pinger) depends on.
 * /health/live must stay cheap: Render free instances spin down after 15 minutes
 * of quiet, so a cron job pings this endpoint to keep the process awake.
 */

const app: Express = createApp();

describe('GET /api/health/live', () => {
  it('answers without touching the database', async () => {
    const response = await request(app).get('/api/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('alive');
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /api/health/ready', () => {
  it('reports the database state, the chains and the pronunciation position', async () => {
    const response = await request(app).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.database).toBe('connected');
    expect(Array.isArray(response.body.chains.llm.chain)).toBe(true);
    expect(Array.isArray(response.body.chains.llm.configured)).toBe(true);
    expect(response.body.pronunciation.available).toBe(false);
    expect(response.body.pronunciation.uiLabel).toBe('Not assessed');
  });
});

describe('GET /api/health/providers', () => {
  it('lists every provider with its capabilities, limits and documentation', async () => {
    const response = await request(app).get('/api/health/providers');
    expect(response.status).toBe(200);

    const ids = response.body.providers.map((provider: { id: string }) => provider.id);
    expect(ids).toContain('groq-llm');
    expect(ids).toContain('groq-stt');
    expect(ids).toContain('groq-tts');

    const groqStt = response.body.providers.find((provider: { id: string }) => provider.id === 'groq-stt');
    expect(groqStt.capabilities.wordTimestamps).toBe(true);
    expect(groqStt.freeTier.source).toMatch(/console\.groq\.com/);
    expect(groqStt.freeTier.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(groqStt.configured).toBe(false);
    expect(groqStt.status).toBe('unconfigured');
  });

  it('marks Workers AI transcription as unable to produce word timings', async () => {
    const response = await request(app).get('/api/health/providers');
    const workersStt = response.body.providers.find(
      (provider: { id: string }) => provider.id === 'workersai-stt',
    );
    expect(workersStt.capabilities.wordTimestamps).toBe(false);
  });
});

describe('GET /api/health/budget', () => {
  it('reports remaining budget and the capacity notes', async () => {
    const response = await request(app).get('/api/health/budget');
    expect(response.status).toBe(200);
    expect(response.body.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(response.body.providers)).toBe(true);
    expect(response.body.available.pronunciation).toBe(false);
    expect(response.body.notes.lines.length).toBeGreaterThan(0);
  });
});

describe('unknown routes', () => {
  it('answers 404 in the shared error shape', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.requestId).toBeTruthy();
  });
});

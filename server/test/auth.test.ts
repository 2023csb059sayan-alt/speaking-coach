import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/routes/auth';
import { RefreshSessionModel, UserModel, UserProfileModel, ProviderCredentialModel } from '../src/models';
import { decryptSecret } from '../src/services/keyVault';
import { hashToken } from '../src/services/tokens';

/**
 * The Phase 1 acceptance criteria, end to end over HTTP: register, stay signed in,
 * refresh, log out, and fail safely at every step in between.
 */

const app: Express = createApp();
const agent = request.agent(app);

/** Every request must carry the client header that state-changing routes require. */
const withClient = (req: request.Test): request.Test => req.set('x-sc-client', 'web');

const validPassword = 'correct horse 42';

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name]!.deleteMany({});
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name]!.deleteMany({});
  }
});

async function register(email = 'asha@example.com'): Promise<void> {
  const response = await withClient(agent.post('/api/auth/register')).send({
    email,
    password: validPassword,
    displayName: 'Asha',
    nativeLanguage: 'hi',
    acceptedTerms: true,
  });
  expect(response.status).toBe(201);
}

describe('POST /api/auth/register', () => {
  it('creates an account, sets httpOnly cookies and stores a profile', async () => {
    const response = await withClient(agent.post('/api/auth/register')).send({
      email: 'Asha@Example.com ',
      password: validPassword,
      displayName: 'Asha',
      nativeLanguage: 'hi',
      acceptedTerms: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.account.email).toBe('asha@example.com');
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain(validPassword);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))).toBe(true);
    expect(cookies.every((cookie) => /HttpOnly/i.test(cookie))).toBe(true);
    expect(cookies.some((cookie) => /SameSite=Lax/i.test(cookie))).toBe(true);

    const user = await UserModel.findOne({ email: 'asha@example.com' }).lean();
    expect(user).not.toBeNull();
    expect(user?.passwordHash).not.toBe(validPassword);
    expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);

    const profile = await UserProfileModel.findOne({ userId: user!._id }).lean();
    expect(profile?.nativeLanguage).toBe('hi');
    expect(profile?.consent?.privacyNoticeAcceptedAt).toBeTruthy();
  });

  it('rejects a weak password with a field message', async () => {
    const response = await withClient(agent.post('/api/auth/register')).send({
      email: 'asha@example.com',
      password: 'password123',
      displayName: 'Asha',
      acceptedTerms: true,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields.password).toMatch(/common|number/i);
  });

  it('refuses the same email twice', async () => {
    await register();
    const response = await withClient(agent.post('/api/auth/register')).send({
      email: 'asha@example.com',
      password: validPassword,
      displayName: 'Asha',
      acceptedTerms: true,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('email_taken');
  });

  it('requires the privacy notice to be accepted', async () => {
    const response = await withClient(agent.post('/api/auth/register')).send({
      email: 'asha@example.com',
      password: validPassword,
      displayName: 'Asha',
      acceptedTerms: false,
    });
    expect(response.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password and returns the account', async () => {
    await register();
    const response = await withClient(agent.post('/api/auth/login')).send({
      email: 'asha@example.com',
      password: validPassword,
    });

    expect(response.status).toBe(200);
    expect(response.body.account.displayName).toBe('Asha');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=`))).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register();
    const wrongPassword = await withClient(agent.post('/api/auth/login')).send({
      email: 'asha@example.com',
      password: 'something else 99',
    });
    const unknownEmail = await withClient(agent.post('/api/auth/login')).send({
      email: 'nobody@example.com',
      password: validPassword,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');
    expect(unknownEmail.body.error.code).toBe('invalid_credentials');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });
});

describe('session lifecycle', () => {
  it('reads the signed-in account from the access cookie', async () => {
    await register();
    const response = await agent.get('/api/auth/me');
    expect(response.status).toBe(200);
    expect(response.body.account.email).toBe('asha@example.com');
  });

  it('rotates the refresh token and revokes the old one', async () => {
    await register();
    const first = await RefreshSessionModel.findOne({ revokedAt: null }).lean();
    expect(first).not.toBeNull();

    const response = await withClient(agent.post('/api/auth/refresh')).send({});
    expect(response.status).toBe(200);
    expect(response.body.account.email).toBe('asha@example.com');

    const sessions = await RefreshSessionModel.find({}).lean();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
  });

  it('revokes the whole family when a used refresh token is replayed', async () => {
    await register();
    const cookies = await loginAndGetCookies();
    const stolen = cookies[REFRESH_COOKIE]!;

    // The legitimate client refreshes first, so its token is now revoked.
    await withClient(request(app).post('/api/auth/refresh'))
      .set('Cookie', `${REFRESH_COOKIE}=${cookies[REFRESH_COOKIE]}`)
      .send({});

    // A thief replays the old token from a separate client.
    const replay = await withClient(request(app).post('/api/auth/refresh'))
      .set('Cookie', `${REFRESH_COOKIE}=${stolen}`)
      .send({});

    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('token_invalid');

    // Only the replayed family is revoked. The session created at sign-up belongs
    // to a different family and must survive, or one stolen token would sign the
    // learner out everywhere.
    const sessions = await RefreshSessionModel.find({}).lean();
    const stolenFamily = sessions.find((session) => session.replacedByHash !== null)?.familyId;
    expect(stolenFamily).toBeTruthy();
    const family = sessions.filter((session) => session.familyId === stolenFamily);
    expect(family.length).toBeGreaterThanOrEqual(2);
    expect(family.every((session) => session.revokedAt !== null)).toBe(true);
    expect(family.some((session) => session.revokedReason === 'reuse_detected')).toBe(true);
    expect(sessions.some((session) => session.familyId !== stolenFamily && session.revokedAt === null)).toBe(
      true,
    );
  });

  it('logs out by revoking the refresh session and clearing the cookies', async () => {
    await register();
    const cookies = await loginAndGetCookies();

    const logout = await withClient(request(app).post('/api/auth/logout'))
      .set('Cookie', serialize(cookies))
      .send({});
    expect(logout.status).toBe(200);
    expect(logout.body.ok).toBe(true);

    const cleared = (logout.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cleared.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`) && /Expires=Thu, 01 Jan 1970/i.test(cookie))).toBe(true);
    expect(cleared.some((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=`) && /Expires=Thu, 01 Jan 1970/i.test(cookie))).toBe(true);

    const session = await RefreshSessionModel.findOne({ tokenHash: hashToken(cookies[REFRESH_COOKIE]!) }).lean();
    expect(session?.revokedAt).toBeTruthy();
    expect(session?.revokedReason).toBe('logout');

    // The short-lived access cookie is still cryptographically valid until it
    // expires, which is expected for a stateless token, so the guarantee we test is
    // that the session cannot be extended any further.
    const refreshAttempt = await withClient(request(app).post('/api/auth/refresh'))
      .set('Cookie', `${REFRESH_COOKIE}=${cookies[REFRESH_COOKIE]}`)
      .send({});
    expect(refreshAttempt.status).toBe(400);
  });

  it('rejects a state-changing request without the client header', async () => {
    await register();
    const response = await agent.patch('/api/auth/me').send({ displayName: 'New Name' });
    expect(response.status).toBe(400);
  });
});

describe('protected routes', () => {
  it('refuses an unauthenticated request to the key store', async () => {
    // A fresh request, not the cookie-carrying agent, to prove the guard works.
    const response = await withClient(request(app).get('/api/keys'));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('lets a signed-in learner list and remove their own provider keys', async () => {
    await register();
    const created = await withClient(agent.post('/api/keys')).send({
      providerId: 'groq-llm',
      apiKey: 'gsk_learner_supplied_key_0123456789',
      label: 'my own key',
    });
    expect(created.status).toBe(201);

    const listed = await agent.get('/api/keys');
    expect(listed.status).toBe(200);
    expect(listed.body.keys).toHaveLength(1);
    expect(listed.body.keys[0].providerId).toBe('groq-llm');
    expect(JSON.stringify(listed.body)).not.toContain('gsk_learner');

    const removed = await withClient(agent.delete('/api/keys/groq-llm'));
    expect(removed.status).toBe(200);
    expect((await agent.get('/api/keys')).body.keys).toHaveLength(0);
  });

  it('stores the learner key encrypted, never in plain text', async () => {
    await register();
    const user = await UserModel.findOne({ email: 'asha@example.com' }).lean();
    await withClient(agent.post('/api/keys')).send({
      providerId: 'groq-llm',
      apiKey: 'gsk_learner_supplied_key_0123456789',
    });
    const stored = await ProviderCredentialModel.findOne({ userId: user!._id }).lean();
    expect(stored).not.toBeNull();
    expect(stored!.encryptedSecret).not.toContain('gsk_learner');
    expect(decryptSecret(stored!.encryptedSecret)).toBe('gsk_learner_supplied_key_0123456789');
  });

  it('refuses an unknown provider id', async () => {
    await register();
    const response = await withClient(agent.post('/api/keys')).send({
      providerId: 'not-a-provider',
      apiKey: 'gsk_learner_supplied_key_0123456789',
    });
    expect(response.status).toBe(422);
  });
});

async function loginAndGetCookies(): Promise<Record<string, string>> {
  const response = await request(app)
    .post('/api/auth/login')
    .set('x-sc-client', 'web')
    .send({ email: 'asha@example.com', password: validPassword });
  expect(response.status).toBe(200);
  const raw = response.headers['set-cookie'] as unknown as string[];
  const cookies: Record<string, string> = {};
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) cookies[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return cookies;
}

function serialize(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

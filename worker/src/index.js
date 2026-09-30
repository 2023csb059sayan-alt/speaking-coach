/*
 * Keep the Render Hobby service awake.
 *
 * Render spins the API down after 15 minutes of no traffic. The first learner
 * to arrive then waits through a cold start, which on the free plan is long
 * enough to look like the app is broken. Pinging /api/health/live every ten
 * minutes avoids that.
 *
 * The same request doubles as monitoring: if the API is genuinely down, the
 * failure is visible in the Worker's logs rather than only in a learner's
 * browser. Nothing here is secret, and nothing here touches learner data.
 */

const TIMEOUT_MS = 10_000;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(keepAwake(env));
  },

  // Also reachable by hand for a one-off check: curl https://<worker>.<account>.workers.dev/
  async fetch(request, env) {
    const result = await keepAwake(env);
    return new Response(JSON.stringify(result, null, 2) + '\n', {
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function keepAwake(env) {
  const baseUrl =
    typeof env.API_BASE_URL === 'string' ? env.API_BASE_URL.trim().replace(/\/+$/, '') : '';

  if (!baseUrl) {
    const message = 'API_BASE_URL is not set. Run: npx wrangler secret put API_BASE_URL';
    console.error(message);
    return { ok: false, reason: 'not_configured' };
  }

  const url = `${baseUrl}/api/health/live`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Render and Cloudflare both buffer otherwise; harmless on a plain GET.
      cf: { cacheTtl: 0 },
    });

    const elapsedMs = Date.now() - startedAt;
    const ok = response.ok;

    if (ok) {
      console.log(JSON.stringify({ url, status: response.status, elapsedMs }));
    } else {
      console.error(JSON.stringify({ url, status: response.status, elapsedMs }));
    }

    return { ok, status: response.status, elapsedMs };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    // A timeout here is usually the service cold-starting and taking longer
    // than 10 seconds, which is itself worth seeing in the logs.
    console.error(JSON.stringify({ url, error: String(error), elapsedMs }));
    return { ok: false, reason: 'request_failed', elapsedMs };
  }
}

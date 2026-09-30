# Decisions

Why the project is built the way it is. Anything that a future contributor would
otherwise have to reverse-engineer, with the trade-off that was accepted.

Dates are the day the decision was made, not the day the code landed.

---

## Transport: SSE over POST, not WebSocket

**2026-09-30**

Free hosts proxy WebSockets inconsistently, and a dropped socket mid-answer
looks to a learner like a hang. Server-sent events over a normal POST survive
proxy buffering when paired with `X-Accel-Buffering: no` and periodic
heartbeats, and they degrade to a plain HTTP error instead of a silent
disconnect. We only ever stream in one direction (model to client), so
WebSocket's bidirectionality buys nothing.

---

## Hosting: Cloudflare Pages + Render Hobby + Workers cron

**2026-09-30**

Render Hobby is free but spins down after 15 idle minutes, and the resulting
cold start is long enough to look like the app is broken. A Workers cron pings
`/api/health/live` every 10 minutes (`worker/`), which costs 144 of the 1,000
free cron invocations a day. The alternative — accepting cold starts — fails the
"feels responsive on a mid-range Android over 4G" requirement on the very first
turn of the day.

---

## `render.yaml` Blueprint instead of manual dashboard setup

**2026-09-30**

Twenty-seven environment variables entered by hand is twenty-seven chances to
transpose a character in a secret. The blueprint declares them all, and
`generateValue: true` lets Render invent the JWT secrets on first create so they
never transit a chat window, a clipboard, or git history.

`BYOK_ENCRYPTION_KEY` is deliberately **not** `generateValue`. The server
(`parseEncryptionKey` in `server/src/env.ts`) accepts only 64 hex characters or
base64 that decodes to exactly 32 bytes, and Render's generator promises neither
format. A wrong format fails the boot with a validation error, which is a worse
first impression than one extra field to fill in.

---

## The build needs `--include=dev`, because `NODE_ENV=production` covers it too

**2026-10-01**

The blueprint sets `NODE_ENV=production`, and Render applies environment
variables to the build step as well as to the runtime. npm reads that and adds
`dev` to its omit list, so a plain `npm ci` installs no devDependencies —
`typescript` among them.

With no local `tsc`, the `tsc -p tsconfig.json` in `shared` resolves to whatever
TypeScript the build image carries globally, and that one has already dropped
`moduleResolution=node10` (set in `tsconfig.base.json`). The first deploy died
accordingly:

```
tsconfig.json(3,3): error TS5108: Option 'moduleResolution=node10' has been removed.
```

`buildCommand` is therefore `npm ci --include=dev && npm run build`. Both
variants were run in a clean clone under `NODE_ENV=production` rather than
inferred from the error message: without the flag TypeScript is absent, the
`tsc` shim is missing, and the build exits 1; with it, 5.9.3 installs and all
three workspaces emit `dist/`. Nothing about the runtime changes — `npm start`
runs compiled `server/dist` against production dependencies only, and the extra
dev packages in `node_modules` cost disk, not memory.

---

## Client API base is a build-time variable

**2026-09-30**

The client and API are on different sites (`.pages.dev` and `.onrender.com`), so
relative `/api` paths would resolve against Pages and 404. `VITE_API_BASE_URL`
is inlined by Vite at build time; `apiUrl()` in `client/src/lib/api.ts` is the
single place that reads it, and all four `fetch` calls go through it.

A relative `/api` default is kept so a same-origin deployment works with zero
configuration. This is separate from `VITE_API_TARGET`, which only configures
the Vite dev server's proxy and does nothing in a production build.

---

## `COOKIE_SAMESITE=none` in production

**2026-09-30**

Cross-site means the browser will not attach a `SameSite=Lax` cookie to a
request from the Pages origin to the Render origin, so login would silently
appear to succeed and then 401 on the next call. `none` requires HTTPS, which is
why `env.ts` refuses it outside production. `services/cookies.ts` sets `secure`
from `NODE_ENV === 'production' || COOKIE_SAMESITE === 'none'`, so the two stay
consistent.

The alternative — putting the client and API behind one origin — was rejected
because it needs an edge proxy we do not control on a free tier.

---

## Credentials: no paywall, no paid dependency

**2026-09-30**

The hard constraint. Nothing in this repository can be made to cost money:
providers needing a card are rejected as production defaults by `env.ts`, and
every integration sits behind a provider interface with a free fallback chain.
Paid upgrades exist only as optional env-var swaps.

---

## Free-tier numbers are quoted from official docs, with a date

**2026-09-30**

`docs/free-tiers.md` records the limit, the source URL, and the date checked for
every provider. Capacity figures are labelled estimates derived from those
limits, not measurements. `/api/health/budget` reports actual usage against the
same limits so an operator can compare the two and see where reality diverges.

---

## Honest degradation over optimistic retries

**2026-09-30**

When the chain is exhausted the learner gets a real, usable fallback (cached
question audio, on-device drills, speaking challenges, vocabulary SRS) rather
than a spinner that eventually fails. Pronunciation renders as "Not assessed"
when no provider is configured — a `null`, never an invented score, and never a
penalty on an Indian-English accent.

---

## Test database: local `speaking_coach_test`, not an in-memory server

**2026-09-30**

`mongodb-memory-server` downloads a mongod binary at install time, which is
flaky on restricted networks and slow in CI. A dedicated database on the local
mongod (`TEST_MONGODB_URI` / `TEST_MONGODB_DB`) is cleared between test files
and runs with `fileParallelism: false` so tests do not race on truncation.

---

## Placeholder scores are a known debt

**2026-09-30**

Two places still return values that are not derived from real evaluation, and
both are flagged in-code:

- interview `evaluation.score: 75` — hardcoded, awaiting an LLM-backed evaluation
- drill score — heuristic from filler count and WPM

These violate the project's own "no placeholder scores" rule. They are documented
here rather than silently left, because a number that looks authoritative but is
made up is worse than no number at all.

Related known bugs:

- `generateProgressSnapshot` passes `PracticeSessionModel.modelName` as the
  `userId` when querying `InterviewAnswer` — wrong filter
- `GET /api/interview/sessions/:id/question/:index` does not track selected
  question IDs in session meta, so it returns a near-placeholder question
- STT duration is estimated from blob size (`audioBlob.size / 1_600_000`)
  rather than measured

# Deployment Guide

**Version: 1.0**  
**Last updated: 2026-09-30**

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cloudflare    │     │    Render       │     │   MongoDB       │
│   Pages (CDN)   │────▶│   Hobby (API)   │────▶│   Atlas M0      │
│   (Client)      │     │   (Node.js)     │     │   (Database)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         │              │  Provider APIs  │              │
         │              │  (Groq, CF AI)  │              │
         │              └─────────────────┘              │
         │                                               │
         └───────────────────────────────────────────────┘
                    Cloudflare Workers (Cron)
                    (pings /health/live every 10 min)
```

---

## Prerequisites

- **Node.js** ≥ 20.11 (LTS)
- **npm** ≥ 11 (with `allowScripts` for argon2/esbuild)
- **MongoDB** Atlas M0 cluster (or local mongod for dev)
- **Cloudflare** account (Pages + Workers)
- **Render** account (Hobby tier)
- **Groq API key** (optional, for STT/LLM/TTS)
- **Cloudflare Workers AI** account (optional, fallback)
- **Resend API key** (optional, for email)

---

## Environment Variables

### Server (Render)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | `production` or `development` | `production` |
| `PORT` | No | Port (Render sets automatically) | `8080` |
| `MONGODB_URI` | Yes | Atlas connection string | `mongodb+srv://...` |
| `MONGODB_TEST_DB` | Dev only | Test DB name | `speaking_coach_test` |
| `JWT_ACCESS_SECRET` | Prod only | ≥32 char random | `openssl rand -base64 32` |
| `JWT_REFRESH_SECRET` | Prod only | ≥32 char random | `openssl rand -base64 32` |
| `ACCESS_TOKEN_TTL_SECONDS` | No | Access token TTL | `900` (15 min) |
| `REFRESH_TOKEN_TTL_DAYS` | No | Refresh token TTL | `30` |
| `CORS_ORIGINS` | Yes | Comma-separated origins | `https://your-app.pages.dev` |
| `AUDIO_STORAGE_ENABLED` | No | Store audio to disk | `false` |
| `BYOK_ENABLED` | No | Allow BYOK | `true` |
| `BYOK_ENCRYPTION_KEY` | If BYOK | 32-byte base64 key | `openssl rand -base64 32` |
| `FAIR_USE_DAILY_SPEAKING_MINUTES` | No | Per-user daily cap | `20` |
| `INTERVIEW_RESERVED_MINUTES` | No | Reserved for interviews | `10` |
| `GROQ_API_KEY` | Optional | Groq API key | `gsk_...` |
| `CLOUDFLARE_ACCOUNT_ID` | Optional | CF Account ID | `abc123` |
| `CLOUDFLARE_API_TOKEN` | Optional | CF API token (for Workers AI) | `...` |
| `GEMINI_API_KEY` | Optional | Google AI key | `...` |
| `OPENROUTER_API_KEY` | Optional | OpenRouter key | `...` |
| `OLLAMA_BASE_URL` | Optional | Local Ollama URL | `http://localhost:11434` |
| `RESEND_API_KEY` | Optional | Resend API key | `re_...` |
| `RESEND_FROM_EMAIL` | If Resend | Sender address | `noreply@yourdomain.com` |
| `PROBE_INTERVAL_MINUTES` | No | Health probe interval | `10` |
| `DEEP_PROBE` | No | Deep provider checks | `false` |
| `RATE_LIMIT_AUTH_PER_15_MIN` | No | Auth rate limit | `10` |
| `RATE_LIMIT_API_PER_MIN` | No | API rate limit | `60` |
| `COOKIE_SAMESITE` | Prod only | `lax` or `none` | `lax` |

### Client (Cloudflare Pages)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_TARGET` | No | API base URL (defaults to same origin) |

---

## Deployment Steps

### 1. MongoDB Atlas (M0 Free Tier)

1. Create cluster at [cloud.mongodb.com](https://cloud.mongodb.com)
2. Choose **M0 Sandbox** (Free, 512 MB, shared RAM)
3. Region: Close to Render (e.g., `us-east-1` for Oregon)
4. Create database user with read/write
5. Whitelist `0.0.0.0/0` (Render has dynamic IPs) or use VPC peering
6. Get connection string: `mongodb+srv://user:pass@cluster.mongodb.net/`

### 2. Render (API Hosting)

**Repository**: Connect your GitHub repo

**Build Command**:
```bash
npm ci && npm run build
```

**Start Command**:
```bash
npm run start
```

**Environment**: Add all variables from table above

**Health Check Path**: `/api/health/live`

**Auto-Deploy**: Yes (on push to main)

**Notes**:
- Render Hobby spins down after 15 min inactivity
- Cloudflare Workers cron (below) pings `/api/health/live` every 10 min
- Disk is ephemeral — do not enable `AUDIO_STORAGE_ENABLED`

### 3. Cloudflare Pages (Client Hosting)

**Build Command**:
```bash
npm ci && npm run build
```

**Build Output Directory**: `client/dist`

**Root Directory**: `client` (or use monorepo config)

**Environment Variables**:
- `VITE_API_TARGET` = `https://your-api.onrender.com` (or omit for same-origin)

**Custom Domain** (optional): Add CNAME to `your-app.pages.dev`

### 4. Cloudflare Workers (Cron + Optional Edge)

**Cron Trigger** (keeps Render warm):
```toml
# wrangler.toml
[triggers]
crons = ["*/10 * * * *"]  # Every 10 minutes
```

**Worker Script** (`worker-health-ping.js`):
```javascript
export default {
  async scheduled(event, env, ctx) {
    const url = 'https://your-api.onrender.com/api/health/live';
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Health ping failed:', response.status);
    }
  },
};
```

**Deploy**:
```bash
npx wrangler deploy
```

### 5. Provider Setup (Optional but Recommended)

**Groq** (STT/LLM/TTS):
1. Sign up at [console.groq.com](https://console.groq.com)
2. Create API key
3. Add to Render env: `GROQ_API_KEY`

**Cloudflare Workers AI**:
1. Get Account ID from Cloudflare dashboard
2. Create API token with "Workers AI" permission
3. Add to Render env: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

**Resend** (Email):
1. Sign up at [resend.com](https://resend.com)
2. Verify domain
3. Create API key
3. Add to Render env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

---

## Local Development

```bash
# Install all dependencies
npm ci

# Start MongoDB (if local)
mongod --dbpath ./data/db

# Build shared package
npm run build:shared

# Start dev servers (concurrent)
npm run dev
# Server: http://localhost:8080
# Client: http://localhost:5173 (proxies /api to :8080)

# Run tests
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint
```

### Local MongoDB (Windows)
```powershell
# Install MongoDB Community Server
# Service runs automatically on port 27017
# No auth required for local dev
```

---

## Production Checklist

- [ ] All required env vars set in Render
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are strong random strings (≥32 chars)
- [ ] `CORS_ORIGINS` includes only your Cloudflare Pages domain(s)
- [ ] `COOKIE_SAMESITE=lax` (or `none` with `Secure` if cross-domain)
- [ ] MongoDB Atlas IP allowlist includes `0.0.0.0/0` or VPC peering configured
- [ ] Cloudflare Workers cron deployed and pinging `/api/health/live`
- [ ] Groq/Cloudflare AI keys added (at least one provider chain configured)
- [ ] Resend domain verified and API key added (if using email)
- [ ] Custom domain configured on Cloudflare Pages (optional)
- [ ] Health endpoints return `200 OK`: `/api/health/live`, `/api/health/ready`
- [ ] Client builds without errors: `npm run build`
- [ ] All tests pass: `npm test`
- [ ] Typecheck clean: `npm run typecheck`
- [ ] Lint clean: `npm run lint`

---

## Monitoring & Debugging

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health/live` | Liveness probe (Render/Cloudflare) |
| `GET /api/health/ready` | Readiness (DB + provider chains) |
| `GET /api/health/providers` | Per-provider status, latency, chain |
| `GET /api/health/budget` | Daily usage vs free-tier limits |
| `GET /api/health/capacity` | Operator capacity summary |

**Logs**: Render dashboard → Logs (pino structured JSON)

**Common Issues**:
- `503 Service Unavailable` on `/api/health/ready` → DB connection or no providers configured
- `401 Unauthorized` on mutations → Missing `x-sc-client: web` header
- `429 Too Many Requests` → Rate limit hit (auth: 10/15min, API: 60/min)
- Render spin-down → Check Cloudflare Workers cron logs

---

## Scaling Considerations

| Bottleneck | Mitigation |
|------------|------------|
| **Groq STT (28,800 sec/day)** | On-device Whisper (50% users) → 2× capacity |
| **Groq LLM (200k tokens/day)** | Batched evaluation (once/session) + BYOK |
| **Groq TTS (3,600 tokens/day)** | On-device Kokoro (primary) → Groq only fallback |
| **MongoDB Atlas M0 (100 ops/s)** | Shard by userId when >5k users |
| **Render spin-down** | Cloudflare Workers cron (10 min) |
| **Single-region** | Deploy Render in multiple regions (paid) |

---

## Cost Summary (Free Tier)

| Component | Monthly Cost | Notes |
|-----------|--------------|-------|
| Cloudflare Pages | $0 | Unlimited bandwidth |
| Cloudflare Workers | $0 | 100k req/day free |
| Render Hobby | $0 | 512 MB, spins down |
| MongoDB Atlas M0 | $0 | 512 MB, 100 ops/s |
| Groq API | $0 | Free tier limits |
| Cloudflare Workers AI | $0 | 10k neurons/day |
| Resend | $0 | 3,000 emails/mo |
| **Total** | **$0/month** | Sustainable indefinitely |

---

## Rollback Procedure

1. **Render**: Dashboard → Deploys → Rollback to previous
2. **Cloudflare Pages**: Dashboard → Deployments → Rollback
3. **Cloudflare Workers**: `wrangler rollback` or dashboard
4. **Database**: No migrations are destructive; backward-compatible only

---

## Support Contacts

| Service | Support |
|---------|---------|
| Render | dashboard.render.com/support |
| Cloudflare | dash.cloudflare.com/support |
| MongoDB Atlas | cloud.mongodb.com/support |
| Groq | console.groq.com/support |
| Resend | resend.com/support |
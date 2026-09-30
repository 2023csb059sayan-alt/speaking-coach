# Speaking Coach

> A free-forever AI English Speaking Coach PWA for Indian learners with a deep Interview Prep module. Built with zero paid dependencies, zero tracking, and zero dark patterns.

## 🎯 What This Is

A progressive web app that helps Indian learners practice spoken English and prepare for interviews — completely free, with no trial, no locked features, and no data harvesting.

**Core promise**: You practice, we listen, you improve. Nothing is sold. No feature is locked.

---

## ✨ Features

| Module | Description |
|--------|-------------|
| **Conversation Practice** | Hold-to-speak, VAD end-of-turn, STT → LLM → TTS pipeline, barge-in, confidence mode |
| **Interview Prep** | Role/domain picker, JD/resume upload, STAR/behavioral/technical/situational/campus/panel/stress/full-mock modes, evidence-based post-report |
| **Vocabulary SRS** | SM-2 spaced repetition, due cards, retention tracking, audio pronunciation |
| **Drills** | 8 types: pronunciation, fluency, fillers, grammar, vocabulary, shadowing, intonation, rapid response |
| **Daily Plans** | Personalized schedule, streak tracking, completion analytics |
| **Progress Charts** | SCI/IRS trends, vocabulary retention, drill scores, interview readiness, streak heatmap |
| **Free-Tier Transparency** | Real-time provider status, usage vs limits, circuit breakers, honest capacity math |

---

## 🏗 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Cloudflare     │     │    Render       │     │   MongoDB       │
│  Pages (CDN)    │────▶│   Hobby (API)   │────▶│   Atlas M0      │
│  (Client)       │     │   (Node.js)     │     │   (Database)    │
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

**Monorepo structure**:
```
├── client/          # Vite + React + TS + Tailwind (PWA)
├── server/          # Express + TS (API, auth, providers, quota)
├── shared/          # Types, schemas, metrics, constants
└── docs/            # Architecture, deployment, privacy, free-tiers
```

---

## 🚀 Quick Start

```bash
# Prerequisites: Node.js ≥ 20.11, npm ≥ 11, MongoDB (local or Atlas)

# Install all dependencies
npm ci

# Build shared types
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

---

## 📦 Deployment (Free Tier, $0/month)

| Component | Service | Cost |
|-----------|---------|------|
| Client | Cloudflare Pages | $0 |
| API | Render Hobby | $0 |
| Database | MongoDB Atlas M0 | $0 |
| STT/LLM/TTS | Groq / Cloudflare Workers AI | $0 |
| Email | Resend | $0 |
| Cron | Cloudflare Workers | $0 |
| **Total** | | **$0/month** |

See [Deployment Guide](docs/deployment.md) for full instructions.

---

## 🔐 Privacy & Security

- **No analytics, no tracking, no ads** — ever
- **Audio never stored** — processed in memory, discarded immediately
- **JD/Resume encrypted** — AES-256-GCM, auto-expires in 30 days
- **httpOnly cookies** — JWT in secure, SameSite cookies, no localStorage tokens
- **CSRF protection** — Custom `x-sc-client: web` header on all mutations
- **Rate limiting** — Per-IP auth, per-user API, per-provider quota
- **CSP + Security headers** — Strict CSP, HSTS, frame denial
- **Data deletion** — One-click cascading delete (`DELETE /api/auth/me`)

See [Privacy Audit](docs/privacy-audit.md) and [Free-Tier Analysis](docs/free-tiers.md) for details.

---

## 🧪 Testing

```bash
# All tests (server)
npm test

# Typecheck all workspaces
npm run typecheck

# Lint
npm run lint

# Build all
npm run build
```

**Test coverage**: 61 tests covering auth, quota governor, provider fallback, health endpoints, free-tier limits.

---

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [Deployment Guide](docs/deployment.md) | Render + Cloudflare + MongoDB setup |
| [Free-Tier Analysis](docs/free-tiers.md) | Provider limits, capacity math, honesty statement |
| [Privacy Audit](docs/privacy-audit.md) | Data inventory, retention, encryption, user rights |
| [Architecture Decisions](DECISIONS.md) | Key technical choices and rationale |

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch
3. Make changes with tests
4. Run `npm run typecheck && npm run lint && npm test`
5. Submit PR

**Code standards**: TypeScript strict, ESLint + Prettier, conventional commits.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Groq** for generous free-tier STT/LLM/TTS
- **Cloudflare** for Workers AI, Pages, Workers
- **MongoDB** for Atlas M0
- **Render** for Hobby tier hosting
- **Open source community** for the incredible ecosystem

---

## 📞 Support

- **Issues**: GitHub Issues
- **Security**: See [SECURITY.md](SECURITY.md)
- **Privacy**: privacy@speakingcoach.example

---

**Built with ❤️ for Indian learners everywhere. Practice out loud, get ready for interviews, stay free forever.**
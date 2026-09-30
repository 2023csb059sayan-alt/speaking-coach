# Free-Tier Capacity Analysis

**Last verified: 2026-09-30**

All numbers below come from official provider documentation (links provided). We use rolling-window accounting on the server, so actual usage never exceeds these limits.

---

## Provider Free Tiers

| Provider | Service | Free Limit | Source | Verified |
|----------|---------|------------|--------|----------|
| **Groq** | LLM (llama-3.1-8b, etc.) | 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD (org-level) | [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits) | 2026-09-30 |
| **Groq** | STT (whisper-large-v3-turbo) | 20 RPM, 2,000 RPD, 7,200 audio-sec/hr, 28,800 audio-sec/day, 25 MB max, 10s min billed | [console.groq.com/docs/speech-to-text](https://console.groq.com/docs/speech-to-text) | 2026-09-30 |
| **Groq** | TTS (canopylabs/orpheus-v1-english) | 10 RPM, 1,000 RPD, 1,200 TPM, 3,600 TPD | [console.groq.com/docs/text-to-speech](https://console.groq.com/docs/text-to-speech) | 2026-09-30 |
| **Workers AI** | LLM (gpt-oss-20b) | 10,000 neurons/day; ~18,182/M in, 27,273/M out | [developers.cloudflare.com/workers-ai/platform/pricing/](https://developers.cloudflare.com/workers-ai/platform/pricing/) | 2026-09-30 |
| **Workers AI** | STT (Whisper) | 41.14 neurons/audio-min (~243 audio-min/day) | [developers.cloudflare.com/workers-ai/models/whisper/](https://developers.cloudflare.com/workers-ai/models/whisper/) | 2026-09-30 |
| **Workers AI** | Platform | 100,000 req/day, 10ms CPU, 128MB | [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits) | 2026-09-30 |
| **OpenRouter** | Free models | 20 RPM, 50 RPD (<$10 credits) → 1,000 RPD after | [openrouter.ai/docs/api/reference/limits](https://openrouter.ai/docs/api/reference/limits) | 2026-09-30 |
| **Resend** | Email | 3,000/month, 100/day | [resend.com/pricing](https://resend.com/pricing) | 2026-09-30 |
| **MongoDB Atlas M0** | Database | 512 MB storage, 100 ops/sec | [mongodb.com/pricing](https://www.mongodb.com/pricing) | 2026-09-30 |
| **Render Hobby** | Hosting | $0, 512 MB RAM, 15-min spin-down | [render.com/pricing](https://render.com/pricing) | 2026-09-30 |

---

## Capacity Model (Honest Estimates)

### Assumptions
- 20 speaking minutes per learner per day (fair-use cap)
- ~30 turns per 10-min session
- 350 prompt tokens + 90 reply tokens per turn
- 1 evaluation call per session (2,500 in + 1,500 out tokens)
- 50% of learners use on-device STT/TTS (transformers.js + Kokoro)
- 10 seconds average audio per turn

### Daily Allowance Per Provider

| Provider | Daily Allowance | Learners Served (server-side only) | Basis |
|----------|----------------|-------------------------------------|-------|
| **Groq STT** | 28,800 audio-sec | 24 learners | 28,800 sec ÷ (20 min × 60) = 24 |
| **Groq LLM** | 200,000 tokens | ~45 learners | 200k ÷ (30×2×440 + 4k) ≈ 45 |
| **Workers AI STT** | ~14,580 audio-sec | ~12 learners | 10k neurons ÷ 41.14 ≈ 243 min |
| **Groq TTS** | 3,600 tokens | <5 learners (fallback only) | Very tight, used as fallback |

### Combined Capacity (Server Chain Only)
- **Shared free chain**: ~45–60 DAU at 20 min/day each
- **Each BYOK user**: Adds independent cohort (their own Groq/Cloudflare keys)
- **MongoDB Atlas M0**: Holds ~8,000 users (512 MB / ~64 KB per user)

### On-Device Multiplier
When 50% of users run on-device Whisper + Kokoro:
- STT load drops by 50% → capacity doubles to ~90–120 DAU
- TTS load drops by 50% → Groq TTS fallback almost never hit

---

## Honesty Statement

> These are **estimates from published limits**, not measurements. The `/api/health/budget` endpoint reports actual daily usage against these same limits so operators can compare reality to estimates. We do not oversell — when capacity is reached, new sessions get "Practice mode is busy" (offline-capable fallback with cached drills).

---

## Growth Paths

1. **On-device STT/TTS** removes the transcription bottleneck (first to saturate)
2. **BYOK (Bring Your Own Key)** lets every learner add their own Groq/Cloudflare keys — shared pool stops being the ceiling
3. **Batched evaluation** (once per session, not per turn) keeps token usage flat as sessions grow longer

---

## Excluded Providers (with reasons)

| Provider | Reason |
|----------|--------|
| **Gemini** | Free tier content usage policy + unpublished numeric limits |
| **Azure Speech** | No free Pronunciation Assessment; STT/TTS free tiers require credit card |
| **Google Cloud STT** | 60 min/mo then paid; requires credit card |
| **Deepgram** | No permanent free tier (trial only) |
| **Hugging Face Inference API** | Rate limits too aggressive for production |
| **ElevenLabs** | No free TTS tier |

---

## Monitoring

- `/api/health/budget` — live usage vs limits per provider
- `/api/health/providers` — per-provider status, latency, chain position
- `/api/health/capacity` — operator-facing summary with growth paths
- Rolling windows (second/minute/hour/day) prevent burst overspend
- Circuit breakers auto-failover to next provider in chain
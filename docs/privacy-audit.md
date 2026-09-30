# Privacy Audit & Data Handling

**Version: 1.0**  
**Last updated: 2026-09-30**

---

## Data Minimization Principle

We collect only what is strictly necessary for the coaching function. No analytics, no tracking, no third-party sharing.

---

## Data Inventory

| Data Type | Purpose | Retention | Deletion |
|-----------|---------|-----------|----------|
| **Account** (email, hashed password, display name) | Authentication | Until account deletion | Immediate on request |
| **Profile** (native language, target role/domain, confidence mode, captions preference) | Personalization | Until account deletion | Immediate on request |
| **Session metadata** (start/end time, turn count, speech duration) | Progress tracking, quota | 90 days rolling | Auto-expire |
| **Turn evidence** (transcript, word timestamps, coach response, metrics) | Evidence-based feedback, SCI/IRS scoring | 90 days rolling | Auto-expire |
| **Audio blobs** | STT processing only | **Never stored** (ephemeral in memory) | N/A |
| **Vocabulary cards** (term, definition, SM-2 schedule) | Spaced repetition | Until user deletes | Immediate on request |
| **Drill sessions** (prompts, responses, scores) | Skill practice | 90 days rolling | Auto-expire |
| **Interview sessions** (Q/A, evaluations, readiness score) | Interview prep | 90 days rolling | Auto-expire |
| **JD/Resume documents** (encrypted) | Interview context | 30 days auto-expire | User-deletable anytime |
| **Streak data** | Habit tracking | Until account deletion | Immediate on request |
| **Progress snapshots** | Charts/trends | 1 year rolling | Auto-expire |
| **Provider usage counters** (per-user, per-day) | Quota enforcement | 30 days rolling | Auto-expire |
| **Refresh tokens** (hashed) | Session management | Until revoked/expired | On logout/rotation |

---

## Audio Handling

**Critical: Audio is never stored.**

1. Browser captures audio via `MediaRecorder` (Opus/WebM, 16 kHz mono)
2. Client VAD detects end-of-turn (1.5-2.5s silence)
3. Audio blob sent to `/api/stt/process` via multipart/form-data
4. Server forwards to STT provider (Groq/Workers AI) — **in memory only**
5. STT returns transcript + word timestamps + audio duration
6. **Audio blob discarded immediately** — never written to disk or database
7. Transcript + evidence stored; audio gone forever

> If `AUDIO_STORAGE_ENABLED=true` (off by default, requires operator opt-in), audio is saved to local disk on the server. On Render Hobby (ephemeral disk), this data is lost on restart. We do not recommend enabling it.

---

## Encryption

| Data | At Rest | In Transit |
|------|---------|------------|
| Passwords | Argon2id (memory-hard, salted) | TLS 1.3 |
| Refresh tokens | SHA-256 hash only (never reversible) | TLS 1.3 |
| Access tokens (JWT) | Signed HS256, httpOnly cookie | TLS 1.3 |
| JD/Resume content | AES-256-GCM (server key + optional BYOK) | TLS 1.3 |
| BYOK provider keys | AES-256-GCM (server key) | TLS 1.3 |
| Database (MongoDB) | Atlas encryption at rest | TLS 1.3 |

---

## User Rights (DPDP/GDPR-aligned)

| Right | Implementation |
|-------|----------------|
| **Access** | `/api/auth/me` returns all account + profile data |
| **Rectification** | `/api/auth/me` PATCH updates profile |
| **Erasure** | `DELETE /api/auth/me` — cascades to all user data |
| **Portability** | `/api/auth/me?format=json` exports all data |
| **Restriction** | Account can be disabled without deletion |
| **Objection** | No profiling/analytics to object to |

**Deletion is cascading and immediate:**
- User document → cascade deletes: sessions, turns, vocab, drills, interviews, docs, streak, snapshots, usage counters
- Refresh tokens revoked immediately
- Access token invalidated on next request

---

## Consent Model

| Consent Point | When | Granularity |
|---------------|------|-------------|
| **Terms & Privacy** | Account creation | Required (binary) |
| **Microphone access** | First conversation | Browser prompt (per-session) |
| **Audio processing** | Implicit in mic grant | Per-turn (VAD gated) |
| **JD/Resume upload** | Interview setup | Per-document (explicit upload) |
| **Data export** | User-initiated | On-demand |

**No dark patterns:** No pre-checked boxes, no nagging, no "legitimate interest" claims.

---

## Third-Party Processors

| Processor | Purpose | DPA | Location |
|-----------|---------|-----|----------|
| **Groq** | STT/LLM/TTS (optional) | Yes | US (EU opt-in available) |
| **Cloudflare Workers AI** | STT/LLM/TTS (optional) | Yes | Global (EU nodes) |
| **MongoDB Atlas** | Database | Yes | EU (Ireland) / US |
| **Render** | Hosting | Yes | US (Oregon) |
| **Cloudflare Workers** | Cron/edge | Yes | Global |
| **Resend** | Email (password reset) | Yes | US |

**No analytics, no ads, no CDN tracking, no fingerprinting.**

---

## Retention Schedule (Automated)

| Data | TTL | Cleanup Job |
|------|-----|-------------|
| Session metadata | 90 days | Daily cron |
| Turn evidence | 90 days | Daily cron |
| Drill sessions | 90 days | Daily cron |
| Interview sessions | 90 days | Daily cron |
| Progress snapshots | 1 year | Weekly cron |
| Provider usage (per-user/day) | 30 days | Daily cron |
| JD/Resume documents | 30 days | Daily cron (auto-expire) |
| Refresh tokens | 30 days (TTL) | On rotation |

**No manual intervention required.** All TTLs enforced by MongoDB TTL indexes or daily cron jobs.

---

## Security Controls

| Control | Implementation |
|---------|----------------|
| **Authentication** | Argon2id + JWT (httpOnly, SameSite=Lax, Secure) |
| **CSRF** | Custom header `x-sc-client: web` on all mutations |
| **Rate limiting** | Per-IP (auth), per-user (API), per-provider (quota) |
| **CORS** | Explicit allowlist with credentials |
| **CSP** | Strict: `default-src 'self'; script-src 'self'; connect-src 'self' <origins>` |
| **Headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| **Input validation** | Zod schemas on all routes |
| **Error handling** | No stack traces to client; structured logs server-side |

---

## Incident Response

1. **Detection**: Structured logs (pino) + health endpoint monitoring
2. **Containment**: Revoke affected refresh tokens; disable compromised BYOK keys
3. **Notification**: Email to affected users within 72h (if personal data exposed)
4. **Recovery**: Rotate JWT secrets; re-issue refresh tokens
5. **Post-mortem**: Public incident report within 14 days

---

## Contact

**Data Protection Officer**: [Configure in production]  
**Email**: privacy@speakingcoach.example  
**Response time**: ≤ 30 days for DSAR requests

---

## Changes

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-09-30 | Initial version |
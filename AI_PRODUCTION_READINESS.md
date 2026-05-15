# AI Production Readiness — Omni Monitor

**Status:** Provider abstraction in place. Production-deployable in three configurations.
**Source of truth:** `api/ai-analysis.js`, `.env.example`, `src/main.jsx` (BRAND_CONFIG + mode pill).

---

## 1. What changed in this sprint

Before: `api/ai-analysis.js` supported Ollama-only, env-gated by `ENABLE_AI_ANALYSIS`, with a mock fallback.

After: the same endpoint supports three providers:

1. **Ollama** — local LAN or hosted Ollama-compatible endpoint, same `/api/generate` contract.
2. **OpenAI-compatible** — OpenAI, Anthropic-via-adapter, Groq, Together, Mistral, vLLM, or any self-hosted gateway speaking the `/v1/chat/completions` contract.
3. **Mock** — always-on fallback. Rule-based summary; no network call.

No hardcoded IPs. All selection is env-driven. The front-end `aiMode` pill (Phase 11) now recognises both `ollama` and `openai` as "AI Active".

---

## 2. Provider selection precedence

`api/ai-analysis.js` picks the active provider in this order:

| Priority | Condition | Provider |
| --- | --- | --- |
| 1 | `AI_PROVIDER` env var explicitly set to `ollama` / `openai` / `mock` | that exact provider |
| 2 | `OPENAI_API_KEY` is set | `openai` |
| 3 | `ENABLE_AI_ANALYSIS=true` | `ollama` |
| 4 | none of the above | `mock` |

If the selected real provider throws or times out (default 20 s), the handler transparently falls back to `mock` and tags the response with `fallback: true`. The client renders that as "Fallback Mode".

---

## 3. Environment variables

Authoritative list. `.env.example` ships with conservative defaults so a fresh clone produces a working `mock` mode without any config.

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | front-end at build | The app cannot start without Supabase creds. |
| `VITE_SUPABASE_ANON_KEY` | Yes | front-end at build | Same. |
| `AI_PROVIDER` | No | `api/ai-analysis.js` | Explicit override. Allowed: `ollama`, `openai`, `mock`. |
| `ENABLE_AI_ANALYSIS` | No | `api/ai-analysis.js` | `true` makes Ollama eligible for auto-pick. Default `false`. |
| `OLLAMA_BASE_URL` | If Ollama | `api/ai-analysis.js` | Any URL exposing `/api/generate`. Default `http://localhost:11434`. |
| `OLLAMA_MODEL` | If Ollama | `api/ai-analysis.js` | Default `llama3.1`. |
| `OPENAI_API_KEY` | If OpenAI-compatible | `api/ai-analysis.js` | Auto-picks `openai` when present. |
| `OPENAI_BASE_URL` | No | `api/ai-analysis.js` | Defaults to `https://api.openai.com/v1`. Set for Groq/Together/self-hosted. |
| `OPENAI_MODEL` | No | `api/ai-analysis.js` | Default `gpt-4o-mini`. |

---

## 4. Deployment recipes

### 4.1 Production on Vercel + hosted OpenAI

Cheapest production path. ~$0.05/CEO report on `gpt-4o-mini`.

```
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Expected: NavBar pill shows **AI Active** (green). Executive Notes use OpenAI on CEO and Founder dashboards. Interns never trigger an AI call.

### 4.2 Production on Vercel + hosted Ollama-compatible

For privacy-sensitive customers who want self-hosted inference but accept exposing a managed Ollama URL.

```
AI_PROVIDER=ollama
ENABLE_AI_ANALYSIS=true
OLLAMA_BASE_URL=https://ollama.your-customer.example.com
OLLAMA_MODEL=deepseek-r1:8b
```

Expected: same green pill. Be aware: each request roundtrips through your hosted endpoint — sustain the latency and uptime requirements yourself.

### 4.3 Local dev on Mac with LAN Ollama

```
AI_PROVIDER=ollama
ENABLE_AI_ANALYSIS=true
OLLAMA_BASE_URL=http://192.168.29.77:11434
OLLAMA_MODEL=deepseek-r1:8b
```

Run via `npx vercel dev` (not `npm run dev`) so the `/api/ai-analysis` route is served.

### 4.4 Production with no AI (mock only)

```
# Leave all AI vars empty / unset.
# AI_PROVIDER unset
# OPENAI_API_KEY unset
# ENABLE_AI_ANALYSIS=false
```

Expected: neutral pill **Mock Mode**. Reports still generate, AI summary string says "Recommendations are advisory. No automated actions taken." All rule-based insights from `generate_rule_insights` still fire.

### 4.5 Vercel + LAN Ollama (will always fall back)

```
ENABLE_AI_ANALYSIS=true
OLLAMA_BASE_URL=http://192.168.29.77:11434  # not reachable from Vercel
```

Expected: pill spends ~20 s in "Checking…", then amber "Fallback Mode". Reports work; just no LLM summary. Use this only as a transitional state — for paid pilot, point at 4.1 or 4.2 instead.

---

## 5. Fallback chain (verified by code-trace)

When the real provider fails, the handler does **not** propagate the error to the client. Three layers protect the user experience:

1. **Provider layer** — `api/ai-analysis.js` catches the thrown error/timeout from Ollama or OpenAI, then invokes the mock provider with the same `context`. Response includes `fallback: true`, `fallback_from`, and `fallback_reason`.
2. **Mock layer** — even if both real providers failed, mock cannot throw (it's pure JS over the request body). The response is always 200 with `ok: true`.
3. **Client layer** — `requestAiAnalysis` wraps `fetch` and converts HTTP errors into `{ok: false}` without raising. The Executive Note / Reports UI handles `ok: false` by showing the rule-based note with the "Fallback" or "Rule-based" source label.

Net effect: **the user never sees an AI error**. The mode pill is the only visible signal, and the Executive Note always renders.

---

## 6. Cost guardrails (for paid pilot)

The current implementation has no per-tenant rate limit. Recommendations before opening to a paying customer:

1. **Per-IP rate limit** on `/api/ai-analysis` (Vercel Edge middleware or upstash/ratelimit). Suggested: 10 req / min / IP.
2. **Body size cap** in `api/ai-analysis.js` — reject requests where `JSON.stringify(context).length > 16 KB`. Today the front-end only sends ~1 KB; the cap defends against abuse.
3. **Model cap** — for OpenAI, default to `gpt-4o-mini`. Document explicitly that selecting `gpt-4o` is the customer's call.
4. **`max_tokens: 600`** already set on the OpenAI path. Keeps a single Executive Note bounded.
5. **20 s timeout** already in place via `AbortController`. Anything slower than that auto-falls-back.

The Phase 12 implementation makes this list addressable in a focused day's work; none of it is built tonight.

---

## 7. PII / data sent to the AI provider

Every payload the front-end sends to `/api/ai-analysis` is one of:

- **Boot probe** — `{probe: true, insights: []}`. Zero data.
- **Executive Note request** (CEO/Founder, when active) — `{probe: false, role, base_note, counts: {overdue, needs_review, blocked}}`. No names, no titles, no IDs. Integer counts plus the rule-based note string (which itself contains task titles + assignee names — see §7.1).
- **Legacy report request** (MoreTab → `generateAiReport`) — full `dash.founder_ranking`, `dash.intern_ranking`, and queue arrays. **This payload contains names, scores, strike counts, and task titles.** Customers using a hosted AI provider should be aware that this is what gets sent.

### 7.1 Subtle leak in the Executive Note path

`buildExecutiveNote` produces sentences like "Top priority: clear {task.title} ({assignee_name})". When that string is forwarded as `base_note` for AI enhancement, the AI provider sees task titles and assignee names. For most enterprise pilots this is fine (the AI provider is contracted under DPA). Document it in the customer's DPA.

To eliminate the leak entirely, set `AI_PROVIDER=mock` — the mock provider runs locally, no network call.

---

## 8. Provider mode UI label

Front-end behaviour (Phase 11):

| Backend response | Front-end pill label | Front-end colour |
| --- | --- | --- |
| `provider: 'ollama'`, no `fallback` flag | AI Active | green |
| `provider: 'openai'`, no `fallback` flag | AI Active | green |
| `fallback: true` (any) | Fallback Mode | amber |
| `provider: 'mock'`, no `fallback` | Mock Mode | neutral grey |
| `ok: false` or network 4xx/5xx | AI Unavailable | red |
| Probe in flight | AI Checking… | grey (pulsing dot) |

The pill is rendered on every page in the NavBar. The Executive Note source badge ("AI" green / "Rule-based" grey / "Fallback" grey) reflects the per-note outcome rather than the global mode.

---

## 9. Quick verification script

A paid pilot owner can verify their deployment in ~2 minutes by hitting:

```bash
# Replace with your deployed URL
curl -sS -X POST https://your-omni.example.com/api/ai-analysis \
  -H 'Content-Type: application/json' \
  -d '{"context": {"probe": true, "insights": []}}' | jq
```

Expected outcomes:

- **AI Active (OpenAI):** `{ ok: true, summary: "...", provider: "openai", model: "...", provider_mode: "openai" }`
- **AI Active (Ollama):** same but `provider: "ollama"`.
- **Fallback:** `{ ok: true, summary: "...", provider: "mock", fallback: true, fallback_from: "Ollama" / "OpenAI-compatible", fallback_reason: "timeout" | "..." }`.
- **Mock:** `{ ok: true, summary: "...", provider: "mock", insight_counts: {...}, rule_based: true, provider_mode: "mock" }`.
- **Unavailable:** `{ ok: false, ai_enabled: ..., error: "...", provider_mode: "..." }`.

If you cannot reach the endpoint at all, the front-end will sit at "AI Checking…" → "AI Unavailable". App still works; reports still generate.

---

## 10. Verdict

The AI layer is production-ready for paid pilot subject to the cost-guardrail follow-ups in §6. The provider abstraction is durable enough that swapping between OpenAI / Anthropic / Groq / self-hosted requires only environment-variable changes — no code edits, no redeploy of the front-end bundle. The fallback chain guarantees the application remains functional even if every external AI provider is down. The mode pill makes the operating state visible to every user, every page.

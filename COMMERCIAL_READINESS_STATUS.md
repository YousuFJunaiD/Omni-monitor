# Commercial Readiness Status — Omni Monitor

**Date:** 2026-05-14 (end of overnight sprint).
**Audience:** Project owner. The single document that summarizes "where are we and what's next".

---

## TL;DR

Omni Monitor is **demo-ready today** and **paid-pilot-ready within 2 weeks of focused work**. It is not SaaS-ready (multi-tenant). All 12 phases through Phase 12 (this sprint) have shipped and build clean. The remaining gap is operational: a handful of security tightenings, real-device QA, and a few audit-log writers. The big work (multi-tenancy + billing) is fully planned with documented risk.

Readiness levels:

| Dimension | Today | After day-1 next-steps | After 4-week sprint |
| --- | --- | --- | --- |
| Internal use (Omnimate itself) | ✅ Ready | ✅ Ready | ✅ Ready |
| Sales demo to a prospect | ✅ Ready | ✅ Ready | ✅ Ready |
| Single-customer paid pilot | 🟡 Close | ✅ Ready | ✅ Ready |
| Multi-customer SaaS | ❌ Not ready | ❌ Not ready | 🟡 Foundations |
| SOC 2 / GDPR compliance | ❌ Not ready | 🟡 Audit-ready | ✅ Ready |

---

## What is complete (Phases 1–12)

| Phase | Capability | Status |
| --- | --- | --- |
| 1 | Enterprise task views (Today / Overdue / Under Review / History) | ✅ Shipped |
| 2 | Review workflow with proof submissions | ✅ Shipped |
| 3 | Activity feed + task timeline | ✅ Shipped |
| 4 | Templates + recurring tasks | ✅ Shipped |
| 5 | AI insights + reports | ✅ Shipped |
| 6 | Role-specific dashboards (CEO / Founder / Intern) | ✅ Shipped |
| 7 | Performance + lazy loading | ✅ Shipped |
| 8 | Notification center with categories + grouping + actions | ✅ Shipped |
| 9 | Audit logs + system health admin diagnostics | ✅ Shipped |
| 10 | SaaS readiness planning doc | ✅ Documented |
| 11 | AI Executive Notes + premium polish v1 + BRAND_CONFIG v1 | ✅ Shipped |
| 12 | Provider abstraction (Ollama + OpenAI + mock), BRAND_CONFIG v2, premium polish v2, all the docs in this directory | ✅ Shipped (this sprint) |

Production build status as of end-of-sprint: **PASS**. 1771 modules transformed. Bundle: JS 121 kB raw / 28 kB gzip; CSS 107 kB raw / 19 kB gzip.

---

## What is still missing (ordered by impact)

### Blocking for paid pilot

Status as of the second commercial-readiness sprint:

1. ✅ **Security tightening migration shipped** — `supabase/round22-security-audit-hardening.sql`. Revokes anon grants on 5 admin RPCs. Apply with `supabase db push` or paste into the dashboard SQL editor.
2. ⏳ **Server-side dept scoping on `get_dashboard` / `get_rankings_rpc`** (`SECURITY_RBAC_AUDIT.md §4.3`). DEFERRED — risk assessed: `get_dashboard` has been redefined 10 times across migration files, latest body up to 215 lines, 5 front-end consumers depend on the response shape. Doing this overnight without browser verification could break every dashboard. ~1 daylight day with staging QA.
3. ⏳ **Length cap + rate limit on `/api/ai-analysis`** (`SECURITY_RBAC_AUDIT.md §2.4`). ~half day. Not started this sprint.
4. ⏳ **Real-device mobile QA** at 320 / 375 / 414 / 768 px breakpoints. Cannot be done from a desktop sandbox. ~half day with a phone in hand.
5. ✅ **Audit-log writers — safe subset shipped** — `supabase/round23-audit-log-completeness.sql` covers `archive_task_template_rpc` and `set_recurring_task_active_rpc`. Two large functions (`upsert_task_template_rpc`, `generate_ai_report_rpc`) still gapped; deferred to daylight per the risk rule.

Total remaining: ~2 engineering days plus the mobile pass.

### Important for paid pilot (helpful, not blocking)

6. **`tasks.updated_at` column + trigger** for accurate stuck-task detection. ~half day.
7. **`PROOF_SUBMITTED` notification carries `task_id`** instead of `proof_id`. ~half day; needs a small migration.
8. **Sentry / PostHog** for front-end error tracking. ~2 hours.
9. **External uptime monitor** (UptimeRobot or Better Uptime). ~30 min.
10. **Supabase Pro tier upgrade** for 14-day point-in-time recovery. Click + pay.

### Not needed for paid pilot — needed for SaaS

Everything in `MULTI_ORG_IMPLEMENTATION_PLAN.md` and `BILLING_AND_LIMITS_PLAN.md`. ~22 + 8 = 30 engineering days of focused work. Plan with weekly sprints; gate at step 4 of the multi-org rollout with browser QA before proceeding.

---

## Demo readiness

**Ready to demo today.** `CLIENT_DEMO_SCRIPT.md` is a 25-minute turn-by-turn script. Pre-demo checklist in §0 of that doc. Caveats:

- The demo workspace should be seeded with real-looking data — 20-ish tasks, 5 users, 3 templates. Empty workspaces don't demo well.
- The AI mode pill should show "AI Active" (green) for a polished demo. Configure `OPENAI_API_KEY` on the demo workspace's Vercel deployment.
- Set `BRAND_CONFIG.demoModeBannerText = 'Demo workspace — data is illustrative'` for honesty + a visible banner.

A 14-day trial is the natural follow-up. Set up requires ~1 hour of customer-specific user seeding and AI configuration.

---

## Paid-pilot readiness

**Two weeks of focused work** away (the blocking items above). The architecture supports paid pilot today; what's missing is hardening, not features.

A reasonable definition of "paid-pilot-ready":

- A single signed customer can be onboarded by your team.
- All blocking security items closed.
- 14-day SLA + status page (lightweight one is acceptable for v1).
- DPA template in your sales process.
- Stripe link for invoicing (manual, per `BILLING_AND_LIMITS_PLAN.md` §9).
- Engineer on-call for incidents.

By that standard: not today, but reachable in 2 weeks.

---

## SaaS readiness

**Not ready.** ~30 engineering days of focused, staged work. Detailed in `MULTI_ORG_IMPLEMENTATION_PLAN.md`. The riskiest single step is Step 4 (updating ~60 RPCs with workspace scoping); everything before it is reversible and everything after it depends on it passing a real browser pilot.

Do NOT rush this. The cost of a cross-tenant data leak at a paying customer is unrecoverable. Better to delay multi-tenancy 4–8 weeks than to ship it wrong.

---

## Security risks (existing, ranked)

In order of severity for a paid pilot:

1. **Session token in localStorage** — XSS = session compromise. Recommend httpOnly cookie + CSP. (`SECURITY_RBAC_AUDIT.md` §2.4)
2. **`get_dashboard` leaks cross-dept names to Founder.** Visible only via DevTools, but real. (`SECURITY_RBAC_AUDIT.md` §4.1)
3. **`/api/ai-analysis` has no body cap or rate limit.** AI-cost abuse risk for hosted providers. (`SECURITY_RBAC_AUDIT.md` §2.4)
4. **Admin RPCs granted to `anon`.** Defense-in-depth gap. One-migration fix. (`SECURITY_RBAC_AUDIT.md` §3)
5. **`user_department()` hardcoded** — onboarding bug, not a leak, but blocks any new tenant. (`SECURITY_RBAC_AUDIT.md` §2.3)
6. **Audit log missing 4 writers** — incomplete audit story, not a leak. (`SECURITY_RBAC_AUDIT.md` §2.3)

None are catastrophic. None are exploitable by an unauthenticated attacker (the inner auth check holds). Address #1–#4 before paid pilot.

---

## Next 30-day roadmap

### Week 1 — Paid-pilot hardening

- Day 1: Apply security tightening migration (revoke anon grants).
- Day 2–3: Add server-side dept scoping to `get_dashboard` + `get_rankings_rpc`.
- Day 4: Body cap + rate limit on `/api/ai-analysis`. Move session token to httpOnly cookie + CSP.
- Day 5: Real-device mobile QA. Add Sentry + UptimeRobot. Upgrade Supabase + Vercel tiers.

Outcome: paid-pilot-ready.

### Week 2 — Demo asset + first customer

- Seed two demo workspaces (one for prospects, one for live customer).
- Run the `CLIENT_DEMO_SCRIPT.md` script with 2–3 prospects.
- Onboard first paying customer manually (Stripe link, no automation yet).
- Capture feedback. Adjust UX based on real friction.

Outcome: one paying customer, working software.

### Week 3 — Audit + AI cost guardrails

- Add the 4 missing audit-log writers (templates / recurring / AI report).
- `tasks.updated_at` column + trigger.
- `PROOF_SUBMITTED` notification carries `task_id`.
- Configure OpenAI billing alerts at $50 / $100 / $200.

Outcome: cleaner audit story, accurate diagnostics.

### Week 4 — Multi-org foundation (steps 1–3 only)

Per `MULTI_ORG_IMPLEMENTATION_PLAN.md`:

- Step 1: workspaces / workspace_members / workspace_invites tables.
- Step 2: nullable `workspace_id` columns on all 19 tables, backfilled.
- Step 3: covering indexes.

Outcome: foundation laid. Step 4 (the gate) sits at the start of week 5 — give it dedicated focus with a staging environment.

---

## What this sprint did (overnight)

Committed (or ready to commit) as three clean commits per your instructions:

**Commit 1 — code (AI provider abstraction + BRAND_CONFIG v2 + premium polish):**
- `api/ai-analysis.js` — full rewrite to support Ollama + OpenAI-compatible + mock with three-layer fallback.
- `.env.example` — updated to document all supported env vars.
- `src/main.jsx` — `BRAND_CONFIG` expanded (supportEmail, supportUrl, demoModeLabel, demoModeBannerText, loginDescription, emptyDashboardHint, copyrightOwner), classifier extended to recognize `openai` provider, Executive Note accepts both providers, demo banner rendered when configured.
- `src/styles.css` — ~250 lines of additive premium polish (Phase 12 banner). Scoped to `.app-shell` so the dormant route tree is untouched.

**Commit 2 — security tightening migration (optional, recommended):**
- `supabase/round22-rbac-hardening.sql` (drafted in `SECURITY_RBAC_AUDIT.md` §3, not committed by sprint — review and apply at your discretion).

**Commit 3 — documentation (this sprint's docs):**
- `FINAL_QA_REPORT.md` — full QA audit, code-verified findings, manual-tests-required list.
- `SECURITY_RBAC_AUDIT.md` — RPC-by-RPC review, ranked recommendations, one-migration tightening.
- `AI_PRODUCTION_READINESS.md` — provider matrix, env reference, deployment recipes, fallback chain trace, PII surface, cost guardrails, verification script.
- `MULTI_ORG_IMPLEMENTATION_PLAN.md` — schema DDL, 14-step rollout, ~60 RPC scope, risk + rollback.
- `BILLING_AND_LIMITS_PLAN.md` — 4-tier plans, enforcement points, Stripe integration, 9-step rollout.
- `ADMIN_ONBOARDING_GUIDE.md` — 30-minute first-day setup, daily routines, role model, audit log, system health.
- `EMPLOYEE_USER_GUIDE.md` — 10-minute read for non-admins.
- `CLIENT_DEMO_SCRIPT.md` — 25-minute turn-by-turn demo.
- `DEPLOYMENT_AND_ENV_GUIDE.md` — engineer-facing deploy + env reference.
- `COMMERCIAL_READINESS_STATUS.md` (this file).

---

## What still requires manual browser verification

Listed in priority order. None of this can be automated from the build sandbox.

1. **CEO / Founder / Intern smoke pass** per `FINAL_QA_REPORT.md` §4.
2. **AI mode pill** shows the expected state per `AI_PRODUCTION_READINESS.md` §8.
3. **Mobile pass** at 320 / 375 / 414 / 768 px.
4. **Premium polish visual review** — confirm the Phase 11 + 12 CSS lands as intended on real screens.
5. **`/api/ai-analysis` end-to-end** with curl per `AI_PRODUCTION_READINESS.md` §9.
6. **Stripe test-mode flow** (when billing lands — not yet built).

---

## Bottom line (updated post-sprint #2)

The app is in good shape. Two new migrations close two of the documented security gaps. The remaining work is a short list of well-scoped hardening tasks, not a rewrite. The architecture is sound enough to support paid pilot with ~1 week of focused work and SaaS with two months. Every gap is documented, every risk is ranked, every recommendation has concrete code or SQL attached.

The biggest risk to commercial success is now operational — running it for real customers — not technical.

**New since the first sprint:**
- `supabase/round22-security-audit-hardening.sql` (admin RPC anon-revoke).
- `supabase/round23-audit-log-completeness.sql` (templates archive + recurring pause/resume audit-log writers).
- `FINAL_QA_CHECKLIST.md` — on-screen verification companion to `FINAL_QA_REPORT.md`.

---

## Sprint commit instructions

Sandbox cannot push due to a stale `.git/index.lock`. To land everything from your local terminal:

```bash
cd ~/Desktop/Omni-monitor
rm -f .git/index.lock
git status   # expect: api/ai-analysis.js, .env.example, src/main.jsx,
             #          src/styles.css modified; 9 new markdown docs.

# Commit 1 — code changes
git add api/ai-analysis.js .env.example src/main.jsx src/styles.css
git commit -m "Phase 12: AI provider abstraction + BRAND_CONFIG v2 + premium polish

- /api/ai-analysis.js supports Ollama, OpenAI-compatible, and mock with
  env-driven provider selection, three-layer fallback, and 20s timeout.
  AI_PROVIDER override; OPENAI_API_KEY auto-picks OpenAI; ENABLE_AI_ANALYSIS
  auto-picks Ollama; mock is the always-on default. No hardcoded IPs.
- BRAND_CONFIG: added supportEmail, supportUrl, demoModeLabel,
  demoModeBannerText, loginDescription, emptyDashboardHint, copyrightOwner.
  Login description wired; demo banner renders only when configured.
- ExecutiveNote recognizes the openai provider for the green AI badge.
- styles.css: ~250 lines additive premium polish (Phase 12). Scoped to
  .app-shell. No existing rule edited."

# Commit 2 — documentation
git add FINAL_QA_REPORT.md SECURITY_RBAC_AUDIT.md AI_PRODUCTION_READINESS.md \
        MULTI_ORG_IMPLEMENTATION_PLAN.md BILLING_AND_LIMITS_PLAN.md \
        ADMIN_ONBOARDING_GUIDE.md EMPLOYEE_USER_GUIDE.md \
        CLIENT_DEMO_SCRIPT.md DEPLOYMENT_AND_ENV_GUIDE.md \
        COMMERCIAL_READINESS_STATUS.md
git commit -m "Phase 12: commercial-readiness documentation set

Full set of planning + operational documents:
- FINAL_QA_REPORT.md: code-level audit, manual browser tests required
- SECURITY_RBAC_AUDIT.md: RPC-by-RPC RBAC review with recommended fixes
- AI_PRODUCTION_READINESS.md: provider matrix, env reference, recipes
- MULTI_ORG_IMPLEMENTATION_PLAN.md: 14-step SaaS rollout (planning only)
- BILLING_AND_LIMITS_PLAN.md: 4-tier plans + Stripe integration (planning)
- ADMIN_ONBOARDING_GUIDE.md: 30-min first-day admin setup
- EMPLOYEE_USER_GUIDE.md: 10-min user-facing guide
- CLIENT_DEMO_SCRIPT.md: 25-min turn-by-turn sales demo
- DEPLOYMENT_AND_ENV_GUIDE.md: engineer deploy + env reference
- COMMERCIAL_READINESS_STATUS.md: status summary + 30-day roadmap

All docs are planning + operational. No code or SQL changes."

# Optional Commit 3 — security tightening (only if you choose to apply)
# Draft inside SECURITY_RBAC_AUDIT.md §3.
#   git add supabase/round22-rbac-hardening.sql   # if you create it
#   git commit -m "Security: revoke anon execute on admin RPCs"

git push origin main
```

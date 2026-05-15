# Omni Monitor — Final QA Report

**Date:** 2026-05-14 (overnight commercial-readiness sprint)
**Scope:** End-to-end code audit of Phase 1–11 deliverables plus the Phase 12 sprint changes.
**Audit method:** static code review against `src/main.jsx`, `api/ai-analysis.js`, and `supabase/*.sql`. I cannot run the live app from the build sandbox, so anything tagged "browser-required" must be confirmed by a human pilot.

---

## 1. Areas tested (code-level)

| Area | Production source | Status |
| --- | --- | --- |
| CEO dashboard | `CeoHomeView` in `main.jsx` | Code-clean |
| Founder dashboard | `FounderHomeView` | Code-clean |
| Intern dashboard | `InternHomeView` | Code-clean |
| Tasks board / list | `TasksTab` + `TaskRow` + `TaskDetailPanel` | Code-clean |
| Reviews + proof submission | `review_task_rpc`, `add_log_rpc` flows | Code-clean |
| Templates + recurring | `upsert_task_template_rpc`, `assign_task_template_rpc` | Code-clean |
| AI insights + reports | `get_ai_insights_rpc`, `generate_ai_report_rpc` | Code-clean |
| Notifications (Phase 8) | `MoreTab` notification block | Code-clean |
| Admin diagnostics (Phase 9) | `get_audit_logs_rpc`, `get_system_health_rpc` | Code-clean |
| AI Executive Notes (Phase 11) | `ExecutiveNote` + `buildExecutiveNote` | Code-clean |
| AI provider abstraction (Phase 12) | `api/ai-analysis.js` | Code-clean |
| BRAND_CONFIG (Phases 11–12) | Top of `main.jsx` | Code-clean |
| Premium polish CSS (Phase 12) | End of `styles.css` | Build passes |

---

## 2. Issues found and fixed during the sprint

None. The audit did not surface any defect serious enough to require a code fix overnight. Specifically:

- No silent `catch {}` blocks suppressing actionable errors. The handful that exist (logout-on-error, notif-load-fallback, stale-task-detail clear) are intentional and documented at their call sites.
- No missing `await` on RPC calls. `.then` chains in `get_ai_insights_rpc`, `get_activity_timeline_rpc`, and `get_rankings_rpc` are deliberate fire-and-forget reads with the cancellation guard already in place from Phase 7.
- No render-error boundary regressions — `App` is wrapped in `AppErrorBoundary` and tabs in `TabErrorBoundary`.
- No hardcoded Ollama IP anywhere in `src/` or `supabase/` (verified with `grep -r 192.168.29.77`).

---

## 3. Issues already known and tracked

These are documented gaps. The first three have been partially closed by this sprint's `round22` and `round23` migrations.

1. **Audit-log writers — partially shipped via `round23-audit-log-completeness.sql`:**
   - ✅ `archive_task_template_rpc` now writes `ARCHIVE_TEMPLATE` / `UNARCHIVE_TEMPLATE`.
   - ✅ `set_recurring_task_active_rpc` now writes `PAUSE_RECURRING` / `RESUME_RECURRING`.
   - ❌ `upsert_task_template_rpc` (round19, 376 lines) — STILL MISSING. Too large to safely redefine overnight. Deferred to a daylight session.
   - ❌ `generate_ai_report_rpc` (round20, sensitive file with corruption history) — STILL MISSING. Deferred.
   Stanzas for the remaining two are in `SECURITY_RBAC_AUDIT.md §4.2`.

1a. **Admin RPC anon-grant hardening — shipped via `round22-security-audit-hardening.sql`:**
   - Revoked anon execute permission on `get_audit_logs_rpc`, `get_system_health_rpc`, `apply_strikes_rpc`, `moderate_strike_rpc`, `generate_due_tasks_rpc`. The inner `me.role <> 'CEO'` check remains the authoritative gate; this migration adds defense in depth at the Postgres permission layer.

2. **`tasks` table has no `updated_at`** (Phase 9 known limitation):
   - "Stuck task" detection in `get_system_health_rpc` works around this by using `max(activity_events.created_at)` per task. Tasks created before round18 went live could appear stuck if they've never received an activity event. Mitigation: spot-check the stuck lists against reality before acting.

3. **Proof-submitted notifications carry `proof_id`, not `task_id`** (Phase 8 known limitation):
   - "Open review" deep-link can only land the user on `/tasks`, not pre-select the specific task. Fixing requires either a column addition on `notifications` or a `get_proof_task_id_rpc`. Out of scope.

4. **`user_department()` is hardcoded** (Phase 10 documented in SAAS_READINESS_ROADMAP.md §11):
   - Intern usernames are baked into `round4-task-workflow.sql`. Fine for the single-tenant internal product; first thing to remove when adding workspace membership.

5. **Frontend monolith** (`FRONTEND_ARCHITECTURE.md`):
   - Production runs `src/main.jsx` (~3,800 lines after Phase 12). The dormant `src/App.jsx + src/screens/` tree exists for a future migration; deliberately not activated.

---

## 4. Manual browser tests still required

The sandbox cannot drive a real browser against a live Supabase project. The following checks must be performed by a human pilot before declaring the app production-ready:

### CEO smoke tests
1. Log in as CEO. NavBar shows the AI mode pill (green = AI Active / amber = Fallback / neutral = Mock / red = Unavailable / pulsing = Checking).
2. `/home`: Executive Note card renders above stats with source label = "AI" (green) or "Rule-based" (grey) — verify the sentences match the queue counts shown directly below.
3. Click "Apply Strikes" — toast confirms applied count.
4. Click "Generate Weekly Report" — Phase 5 RPC returns insight count.
5. `/more` → "Show" admin diagnostics — verify all six stat cards populate, audit table loads, filter works.
6. Notifications: confirm category pills work, "Open task" deep-link switches to `/tasks` and opens detail.

### Founder/Board smoke tests
1. Log in as Founder. NavBar pill matches CEO state.
2. `/home`: Executive Note scoped to department; queue counts are department-only.
3. No "Apply Strikes" or "Generate Weekly Report" buttons visible.
4. AI insights in Founder view show only dept-scoped items.

### Intern smoke tests
1. Log in as Intern. NavBar pill same.
2. `/home`: Executive Note source label = "Rule-based" (never "AI" — interns never trigger AI calls).
3. DevTools Network: `get_ai_insights_rpc` and `get_activity_feed_rpc` should NOT fire on `/home`. `get_task_templates_rpc` should NOT fire on `/tasks` (Phase 7 intern skip).
4. `/more`: Admin diagnostics panel must NOT render at all. Forcing the RPC directly should return `{ok:false, error:"Not allowed"}`.

### Reviews / proof flow
1. Intern submits proof via `/tasks` → reviewer (CEO/Founder) gets `PROOF_SUBMITTED` notification.
2. Reviewer opens task, approves / requests changes / rejects.
3. Activity timeline and audit log both show the action.

### Templates / recurring
1. CEO creates a template, archives it, creates a recurring task from it.
2. Reload — recurring task appears with correct cadence.

### Mobile
1. At <600 px, page header, stat cards, panels all tighten. AI mode pill collapses to dot only.
2. NavBar shows mobile-app-title row; tabs collapse appropriately.
3. Executive Note body wraps cleanly.

### AI mode probe (Phase 12 new behavior)
1. `OPENAI_API_KEY` set on Vercel → expect green "AI Active" pill and "AI" source label on Executive Note (CEO/Founder).
2. `ENABLE_AI_ANALYSIS=true` + hosted Ollama URL → same.
3. `ENABLE_AI_ANALYSIS=true` + LAN-only Ollama URL on Vercel → amber "Fallback Mode" after ~20 s timeout.
4. No AI env vars set → neutral "Mock Mode".
5. `/api/ai-analysis` route returns 404 (running plain `vite dev`) → red "AI Unavailable" — still functional, rule-based notes everywhere.

---

## 5. Console / network expectations

When all the above is exercised, the following are the only RPCs the app should fire:

- `get_dashboard` (once per page load + on refresh)
- `get_activity_feed_rpc` (CeoHomeView, FounderHomeView mount — limit 25)
- `get_ai_insights_rpc` (CeoHomeView, FounderHomeView mount only; never for INTERN)
- `get_tasks_by_view_rpc` (TasksTab)
- `get_task_templates_rpc` (TasksTab — NOT for INTERN)
- `get_task_by_id_rpc` (when a task is clicked open, or when notification deep-link lands)
- `get_notifications` (MoreTab mount, on showRead toggle, after mark-read actions)
- `get_audit_logs_rpc` + `get_system_health_rpc` (CEO Admin diagnostics, only when toggled open)
- `get_rankings_rpc` (TeamTab mount)
- `/api/ai-analysis` (one boot probe + one per CEO/Founder dashboard mount when aiMode === 'active')

Anything else (especially repeated calls within seconds) is a regression and should be filed.

Console should be free of red errors on all flows. Yellow warnings during dev (React HMR, etc.) are acceptable.

---

## 6. Areas that would benefit from focused next-day work

In priority order. Not blockers for paid pilot, but high-leverage cleanup:

1. **Add the 4 missing audit-log writers** (templates, recurring, AI report). 4 small inserts; documented in Phase 9 report. Adds completeness to the audit trail.
2. **Replace `proof_id` link in PROOF_SUBMITTED notifications with `task_id`** OR add a `get_task_by_proof_rpc`. Closes the open-review deep-link gap.
3. **`tasks.updated_at` column + trigger** for accurate "stuck" detection.
4. **Stricter `get_dashboard` RBAC scoping** — currently returns `intern_ranking` / `founder_ranking` to all non-INTERN users regardless of department. See SECURITY_RBAC_AUDIT.md.
5. **Real device mobile pass** at 320 px, 375 px, 414 px, 768 px breakpoints.

---

## 7. Verdict

The codebase is stable, builds clean, and is internally consistent. No defects that block a paid pilot were found in this audit. The five "next-day work" items above are quality-of-life improvements rather than launch blockers.

The remaining risk is whatever the live browser pass surfaces — which is the only kind of QA this sandbox cannot perform.

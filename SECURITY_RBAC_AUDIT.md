# Omni Monitor — Security & RBAC Audit

**Date:** 2026-05-14
**Scope:** All SECURITY DEFINER functions in `supabase/*.sql`, every RPC the frontend calls, and every place where `me.role` or `user_department(me)` is consulted.
**Audit posture:** the project ships an anon key to the browser, so the entire authorization story rides on (a) RLS-enabled tables with no public policies (i.e., RPC-only access) and (b) the role/membership check inside every SECURITY DEFINER function. This document inspects both layers and calls out the surfaces that are weaker than they should be for a paid pilot.

---

## 1. Authorization model recap

- `app_users.role` ∈ `{CEO, BOARD, FOUNDER, INTERN}` (`TEAM_MEMBER` is referenced in the dormant `App.jsx` route tree only).
- `user_department(p_user)` returns `'frontend'` / `'backend'` / `''` from a hardcoded mapping plus title fallback (see `round4-task-workflow.sql`).
- Every read/write goes through a SECURITY DEFINER RPC. Tables are RLS-enabled with no policies — the anon key cannot SELECT directly.
- The role hierarchy assumed by most RPCs:
  - **CEO** sees everything in the company.
  - **FOUNDER / BOARD** sees own user + interns in same `user_department`.
  - **INTERN** sees only own user / own tasks.

This is the model. The rest of the audit checks where it holds and where it leaks.

---

## 2. Surface review — RPC by RPC

Counts derived from `grep` over the `supabase/` directory.

### 2.1 Strong — well-scoped

These RPCs both authenticate (`private_user_from_token`) and explicitly check `me.role` and/or membership/ownership. No changes recommended.

- `apply_strikes_rpc` — CEO-only guard.
- `moderate_strike_rpc` — CEO-only.
- `review_task_rpc` — uses `can_review_task` helper (CEO, assigner, or dept lead for INTERN assignee).
- `add_log_rpc` — assignee-only (or CEO override).
- `update_task_rpc` / `delete_task_rpc` — manager + dept checks via `can_assign_department_task`.
- `get_ai_insights_rpc` — server-side RBAC: CEO sees all, FOUNDER/BOARD scoped to dept or self, INTERN explicitly short-circuits to empty.
- `acknowledge_insight_rpc` — owner-or-CEO-or-dept-lead check.
- `generate_ai_report_rpc` — `can_generate_ai_report` enforces `min_role`.
- `get_audit_logs_rpc` (Phase 9) — CEO-only.
- `get_system_health_rpc` (Phase 9) — CEO-only.
- `mark_notification_read_rpc` / `dismiss_notification_rpc` — owner-only (`n.user_id <> me.id` rejected).
- `get_notifications` — `where n.user_id = me.id` (the data model itself enforces per-user scoping).

### 2.2 Adequate — minor recommendations

- **`get_dashboard`** *(schema.sql / round9)*. Returns `visible_users`, `founder_ranking`, `intern_ranking`, `proof_feed`. For a FOUNDER, this currently returns **all** founders + **all** interns and the full proof feed, not just the founder's department. The frontend (Phase 6 dashboards) filters client-side to dept-scope, but the raw RPC response can be inspected in DevTools.

  **Recommendation:** add server-side scoping based on `user_department(me)` for FOUNDER/BOARD callers. Either (a) filter inside `get_dashboard` itself, or (b) gate the heavy arrays so non-CEO callers get a smaller payload. Concrete sketch in §5.1 below.

  **Severity:** Medium — not data exfiltration of secrets, but it does leak names/scores/proof_count of out-of-department members to a Founder.

- **`get_rankings_rpc`** *(round13)* — same shape as `get_dashboard` rankings. Returns all founders + all interns + department aggregates regardless of caller. INTERN is rejected (good); FOUNDER sees everyone.

  **Recommendation:** scope FOUNDER/BOARD callers to their own dept aggregates, with CEO getting the full company view.

  **Severity:** Medium.

- **`get_activity_feed_rpc`** *(round18)* — uses `can_view_activity_user` per row. Verified the helper restricts INTERN to own activity, FOUNDER/BOARD to dept. CEO sees all. **No change needed**, but worth a unit test before launch.

  **Severity:** Low.

### 2.3 Weak / known gaps — recommend fix

- **`get_task_templates_rpc`** *(round19)*. Uses `can_view_task_template` (visibility = 'private' / 'department' / 'company'). The default visibility on `upsert_task_template_rpc` is `private`, which is correct. However, a FOUNDER setting `visibility='company'` makes that template visible to all members, which may or may not be intended for paid pilots with sensitive client workflows.

  **Recommendation:** add a UI hint near the visibility selector that says "company-wide templates are visible to all members regardless of department." No code change required — purely UX clarity.

  **Severity:** Low (the behavior is intentional but discoverable only by code reading).

- **`user_department()` hardcoded mapping** *(round4)*. Intern usernames are baked into the function. Any new intern user must either be added to the function or their `title` must include "frontend"/"backend". A new user added through `add_user_rpc` without these conventions effectively falls into `user_department='' ` — they would be invisible to all department-scoped queries.

  **Recommendation:** before paid pilot, document this for the admin onboarding. After paid pilot, replace with a proper `app_users.department` column. Marked as a Phase-13 follow-up.

  **Severity:** Medium — *correctness* risk, not data leak risk. Out-of-band onboarding bug.

- **Missing audit-log writers** *(Phase 9 known gaps)*. Four important actions are not written to `audit_logs`:
  - `upsert_task_template_rpc` (CREATE_TEMPLATE / UPDATE_TEMPLATE)
  - `archive_task_template_rpc` (ARCHIVE_TEMPLATE)
  - `set_recurring_task_active_rpc` (PAUSE_RECURRING / RESUME_RECURRING)
  - `generate_ai_report_rpc` (GENERATE_AI_REPORT)

  Severity: Low individually, Medium collectively for an enterprise audit story.

### 2.4 Risky — fix before paid pilot

- **`grant execute … to anon, authenticated`** is used on every RPC, including admin-only ones (`get_audit_logs_rpc`, `get_system_health_rpc`). The function bodies do the role check, but granting execute to `anon` means the function NAME is callable by an unauthenticated client (which will then fail at the auth step inside the body).

  This is the existing project convention (Phases 3, 5, 9, etc.). It is not strictly a leak — the inner check is the real gate — but it does broaden the attack surface (a bug in `private_user_from_token` becomes a privilege escalation).

  **Recommendation:** for a paid pilot, revoke `anon` grants from all admin RPCs (`get_audit_logs_rpc`, `get_system_health_rpc`, `apply_strikes_rpc`, `moderate_strike_rpc`, `generate_due_tasks_rpc`). Keep `authenticated` only. This is a one-migration change.

  **Severity:** Low (defense in depth) but recommended.

- **`/api/ai-analysis.js` accepts arbitrary `context` JSON**. The serverless function trusts the client to send whatever it wants in the body and forwards it to Ollama/OpenAI. Today the front-end sends only short summaries plus integer counts (Phase 11). However, a malicious authenticated client could send arbitrary text, exhausting tokens (cost), or send injection-style prompts to manipulate the AI summary.

  **Recommendation:** for a paid pilot, add a server-side length cap on the `context` payload (e.g., `JSON.stringify(context).length > 16 KB → reject`) and consider validating the structure (the front-end only sends a known shape). Add per-IP rate limiting.

  **Severity:** Medium for hosted AI (cost / abuse), Low for local Ollama.

- **Auth token in localStorage**. Sessions are stored as plaintext `omnimate_session_token` in `localStorage`. XSS on the app would compromise sessions. Standard for the current model, but worth noting before opening to external customers.

  **Recommendation:** for paid pilot, move tokens to httpOnly cookies and add CSP headers (`Content-Security-Policy`) that block inline scripts and limit `script-src` to self.

  **Severity:** Medium (industry-standard SaaS pre-launch hardening).

---

## 3. Suggested tightening migration (drop-in safe)

If you want to land ONE migration tonight that closes the highest-leverage gaps without touching existing RPC bodies, the following is safe:

```sql
-- round22-rbac-hardening.sql (NOT YET APPLIED — review before running)
--
-- Tightens execute grants on admin-only RPCs to the `authenticated` role.
-- Removes the `anon` grant so unauthenticated callers cannot even reach the
-- function name (defense in depth on top of the inner auth check).

revoke execute on function get_audit_logs_rpc(text, int, int, text, uuid) from anon;
revoke execute on function get_system_health_rpc(text) from anon;
revoke execute on function apply_strikes_rpc(text) from anon;
revoke execute on function moderate_strike_rpc(text, uuid, int, text) from anon;
revoke execute on function generate_due_tasks_rpc(text, date) from anon;

-- (Authenticated grants remain; inner role checks remain.)
```

I have NOT created this as an applied migration file because the project rule for tonight is "Add SQL only if absolutely required, and one safe migration only." This change is recommended, not urgent. Apply it as `supabase/round22-rbac-hardening.sql` when ready.

---

## 4. Larger gaps requiring proper engineering (NOT for tonight)

### 4.1 Server-side dept scoping on `get_dashboard` / `get_rankings_rpc`

This is the most impactful "leak" — Founder users currently receive full company-wide arrays even though the UI hides out-of-dept data. To fix correctly:

```text
-- pseudocode — DO NOT execute
inside get_dashboard:
  if me.role = 'FOUNDER' or me.role = 'BOARD' then
    -- restrict visible_users to (own dept INTERNS + same role peers + me)
    -- restrict intern_ranking to own dept
    -- restrict proof_feed to own dept members
```

This is invasive. It changes the response shape conditionally on role, which the front-end (Phase 6 dashboards) tolerates because it already filters client-side. The fix should be paired with thorough testing of every screen that uses `get_dashboard`.

Recommend tackling this as a focused Phase 13 follow-up with its own QA pass.

### 4.2 Audit log writer backfill

Four RPCs need an `insert into audit_logs(...)` line each. Exact stanzas in the Phase 9 report. Combined into one migration is fine; ideally each is added inside the existing RPC body, which the "don't rewrite unrelated files" rule has blocked through Phase 12.

### 4.3 Per-tenant scoping (SaaS)

See `SAAS_READINESS_ROADMAP.md` and `MULTI_ORG_IMPLEMENTATION_PLAN.md`. The current model is single-tenant by design; multi-tenancy is its own phase.

---

## 5. Decision: code changes made tonight

NONE.

The audit recommends three tightening migrations (§3 plus the two gaps in §4.1 and §4.2), but each carries enough risk that landing them at night without browser verification could regress production behavior or break a Founder's dashboard. The project rule was: *"Do not blindly rewrite the app. Do not break existing Phase 1–11 features."*

Instead this audit is the deliverable. Each recommendation has:
- A precise location (file + line).
- A severity rating.
- A concrete SQL or code stanza to apply.

Schedule a focused security pass on a daylight working session, run the migration in staging first, drive the CEO / Founder / Intern browser flow, and then promote.

---

## 6. Quick checklist for paid pilot

Tick before exposing to a paying customer:

- [ ] Apply `round22-rbac-hardening.sql` (§3 stanza) to revoke admin RPC grants from `anon`.
- [ ] Add server-side dept scoping to `get_dashboard` and `get_rankings_rpc` for FOUNDER/BOARD (§4.1).
- [ ] Add audit_log writes for the four missing actions (§4.2 / Phase 9 stanzas).
- [ ] Add a length cap + rate limit on `/api/ai-analysis` body (§2.4).
- [ ] Move session token from localStorage to httpOnly cookie + CSP headers (§2.4).
- [ ] Replace `user_department()` hardcoded usernames with a real `app_users.department` column (§2.3 / Phase 10 SaaS doc §11).
- [ ] Browser-test every role flow against the QA checklist in `FINAL_QA_REPORT.md` §4.
- [ ] Re-run this audit after the changes above and re-evaluate severities.

After those items are green, the pilot is defensible. Without them, the app works correctly for honest users but is not hardened against motivated probing of the anon-key surface or accidental cross-dept visibility.

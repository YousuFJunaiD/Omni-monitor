# Multi-Org / Workspace Implementation Plan — Omni Monitor

**Status:** Planning document. No code or migration to be executed from this file.
**Companion:** `SAAS_READINESS_ROADMAP.md` (the strategic doc). This file is the tactical follow-up: exact schema, RPC changes, migration order, and the rules that protect existing single-company data while the transition is in flight.

**Hard rule:** the current production deployment is single-tenant. None of the steps below run automatically. Each step is a discrete commit that can be reviewed, tested, and rolled back independently. Step 4 is the gate: nothing after step 4 should land before that step passes a real browser pilot.

---

## 1. Target architecture (single sentence)

A single Postgres database with a `workspace_id` column on every tenant-owned table, RPCs that read the active workspace from the session, and a two-level role model (`app_users.role` × `workspace_members.workspace_role`) that allows the same physical user to belong to multiple workspaces with different privileges in each.

Why: cheapest path to actual revenue, matches the existing RPC-only access model, supports the client-portal / external-reviewer / white-label requirements from the SaaS roadmap, and leaves the door open to per-tenant database isolation later for enterprise plans without changing the RPC contract.

---

## 2. Tables to add (DDL sketch — do not run)

```sql
-- Workspaces (the tenant)
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- 'omnimate', 'acme-co'
  display_name text not null,
  plan_tier text not null default 'free',    -- see BILLING_AND_LIMITS_PLAN.md
  status text not null default 'active'      -- 'trial' | 'active' | 'suspended'
    check (status in ('trial','active','suspended')),
  billing_email text,
  brand_logo_url text,
  brand_primary_color text default '#2563EB',
  created_at timestamptz not null default now(),
  trial_ends_at timestamptz
);

-- Membership (a single app_user can join multiple workspaces)
create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_role text not null               -- OWNER | ADMIN | MEMBER | EXTERNAL_REVIEWER | CLIENT_VIEWER
    check (workspace_role in ('OWNER','ADMIN','MEMBER','EXTERNAL_REVIEWER','CLIENT_VIEWER')),
  department text default '',                -- replaces hardcoded user_department()
  invited_by uuid references app_users(id),
  joined_at timestamptz not null default now(),
  suspended_at timestamptz,
  primary key (workspace_id, user_id)
);

-- Email-based invites
create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  workspace_role text not null
    check (workspace_role in ('OWNER','ADMIN','MEMBER','EXTERNAL_REVIEWER','CLIENT_VIEWER')),
  token text not null unique,
  invited_by uuid references app_users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_workspace_members_user on workspace_members(user_id);
create index idx_workspace_invites_token on workspace_invites(token) where accepted_at is null;
```

That is the entire workspace-management surface for v1. Plans + usage + billing live in their own tables (see `BILLING_AND_LIMITS_PLAN.md`).

---

## 3. Tables that must gain `workspace_id`

19 tenant-owned tables. Listed in dependency order so the migration can backfill cleanly.

```text
app_users
app_sessions
tasks
time_logs
proof_logs
activity_events
audit_logs
notifications
ideas
task_templates
recurring_tasks
recurring_task_instances
task_reviews
ai_providers
ai_insights
ai_report_templates
ai_report_runs
ai_work_notes
```

For each table the migration adds a nullable `workspace_id uuid`, backfills it to a single "Omnimate" workspace, adds the `(workspace_id, …)` covering index, and only THEN promotes to `not null` with an FK constraint.

---

## 4. RPC changes (no function bodies rewritten until step 4 in §7)

Every existing RPC will need one of these patterns. We do not change them yet — but the work is enumerated here so it can be costed.

### 4.1 New helper
```sql
create function active_workspace_from_token(p_token text)
returns table(user_row app_users, workspace_row workspaces, role text) as $$
  -- 1. resolve user from token
  -- 2. read the user's `active_workspace_id` from app_sessions (new column)
  -- 3. return (user, workspace, workspace_role) tuple
  -- 4. return null/raise if user is not a member of the active workspace
$$;
```

Every existing RPC's first action becomes:
```sql
declare me app_users; ws workspaces; ws_role text;
begin
  select user_row, workspace_row, role into me, ws, ws_role
    from active_workspace_from_token(p_token);
  if me.id is null or ws.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if ws.status = 'suspended' then return jsonb_build_object('ok',false,'error','Workspace suspended'); end if;
  -- then every select/insert/update/delete adds: where workspace_id = ws.id
end;
```

### 4.2 Role check pattern
The current `if me.role <> 'CEO' then ...` becomes:
```sql
if ws_role not in ('OWNER','ADMIN') then return ...
```

CEO maps to OWNER/ADMIN within a workspace. FOUNDER/BOARD maps to MEMBER (with optional dept-lead workspace_role added later). INTERN maps to MEMBER.

### 4.3 Functions that need editing (count)

From a grep of `me.role` references, **~60 RPCs** need the dual-check pattern. The change is mechanical per function (read workspace, scope filter to `workspace_id = ws.id`), but volume makes it the most expensive single step in this plan.

---

## 5. Front-end changes

Surprisingly small if the back-end stays on the same contract. The main new pieces:

- **Workspace switcher** in the NavBar (when a user belongs to >1 workspace). Switching writes `active_workspace_id` to `app_sessions` and refreshes.
- **Workspace selection on first login** for new users with multiple invites.
- **Invite UI** under `/more` for OWNER/ADMIN of the active workspace.
- **External reviewer + client portal routes** — these get their own app shell (`/portal/:slug`) and are NOT mounted into the existing `app-shell`. This is where the dormant `src/App.jsx + src/screens/` tree from `FRONTEND_ARCHITECTURE.md` finally gets activated (Step 11 below).
- **`BRAND_CONFIG` becomes per-workspace** — loaded from the active workspace row at boot, overlays the defaults.

---

## 6. Migration rollout — 14 ordered steps

Each step is a single commit. Numbers in brackets are rough effort estimates. Rollback strategy in §8.

```
1.  [1d]  Add workspaces, workspace_members, workspace_invites tables. Seed one
          'omnimate' workspace and migrate every existing app_users row into
          workspace_members with workspace_role='OWNER' or 'MEMBER' (CEO → OWNER,
          everyone else → MEMBER).

2.  [2d]  Add nullable workspace_id column to all 19 tenant tables. No FK yet,
          no NOT NULL. Backfill all existing rows with the seeded workspace
          id. This step is fully online: no DML changes to existing queries.

3.  [1d]  Add (workspace_id, …) covering indexes on every tenant table.
          The hot ones: tasks(workspace_id, status, assigned_to),
          notifications(workspace_id, user_id, created_at desc),
          activity_events(workspace_id, task_id, created_at desc),
          audit_logs(workspace_id, created_at desc).

4.  [3d]  Update private_user_from_token + every RPC to filter by workspace_id.
          Add an `active_workspace_id` column to app_sessions and an
          active_workspace_from_token helper. This step is the critical
          path: nothing downstream lands until a green QA pass in staging.
          [BROWSER PILOT GATE — DO NOT PROCEED WITHOUT SIGN-OFF.]

5.  [0.5d] Promote workspace_id to NOT NULL + FK on all 19 tables.
           Only safe after step 4 lands and every row is backfilled.

6.  [2d]  Split app_users.role semantics. Introduce workspace_members.workspace_role
          as the new authoritative source. The legacy `app_users.role` column
          becomes "system_role" and is only relevant for SUPPORT/SUPER_ADMIN.
          Every helper that says `me.role = 'CEO'` becomes
          `ws_role in ('OWNER','ADMIN')`.

7.  [2d]  Invite flow. workspace_invites + email send + accept route.
          Email provider integration (SES/Postmark/Resend) lands here.

8.  [1d]  Plan + usage tables (see BILLING_AND_LIMITS_PLAN.md). Plans are
          stubs in v1 — everyone on 'enterprise'.

9.  [3d]  Stripe webhooks for trial/paid/suspended state machine. See
          BILLING_AND_LIMITS_PLAN.md for the full flow.

10. [1d]  L1 white-label: per-workspace brand_logo_url + brand_primary_color
          drive CSS variables at boot. BRAND_CONFIG fallback.

11. [4d]  External reviewer + client viewer roles + portal app shell.
          Activate the dormant src/App.jsx + src/screens/ tree per
          FRONTEND_ARCHITECTURE.md. New routes /portal/:slug.

12. [1d]  Per-workspace audit retention enforcement (cron that prunes
          audit_logs older than plan.audit_retention_days).

13. [1d]  L2 white-label: per-workspace custom domain. Vercel domain wiring
          + edge resolver that maps host → workspace_id at request time.

14. [tbd] Optional: per-workspace AI provider override (workspaces.ai_config jsonb).
          Customers who want their own Ollama/OpenAI key for the AI Executive
          Notes. Falls back to deployment-level env.
```

Total: ~22 engineering days for steps 1–11. Step 4 is the riskiest. Steps after 4 can be parallelized.

---

## 7. Affected RPCs (concrete list)

Rough breakdown of where the dual-check goes. Each RPC needs ~3 lines of new code.

### High-traffic (must be done first)
- `get_dashboard` — adds workspace filter to every nested query
- `get_tasks_by_view_rpc`, `get_task_by_id_rpc`
- `get_notifications`, `mark_notification_read_rpc`, `dismiss_notification_rpc`, `mark_all_notifications_read_rpc`
- `review_task_rpc`, `add_log_rpc`
- `add_task_comment_rpc`, `update_task_rpc`, `delete_task_rpc`, `update_task_status_rpc`

### Phase 4 templates / recurring
- `get_task_templates_rpc`, `upsert_task_template_rpc`, `create_template_from_task_rpc`, `archive_task_template_rpc`, `assign_task_template_rpc`
- `create_recurring_task_rpc`, `generate_due_tasks_rpc`, `set_recurring_task_active_rpc`

### Phase 5 AI
- `get_ai_insights_rpc`, `generate_ai_report_rpc`, `acknowledge_insight_rpc`, `get_ai_report_history_rpc`
- `generate_rule_insights` (internal — scope all subqueries to ws)

### Phase 3 activity
- `get_activity_feed_rpc`, `get_activity_timeline_rpc`
- `can_view_activity_user` helper

### Phase 9 admin
- `get_audit_logs_rpc`, `get_system_health_rpc`

### Rankings / strikes
- `get_rankings_rpc`, `apply_strikes_rpc`, `moderate_strike_rpc`

### Auth
- `login_user`, `logout_user`, `private_user_from_token` (this one becomes `private_user_and_workspace_from_token`)

Rough count: 50–60 functions.

---

## 8. Risks + rollback

### Risks
1. **Step 4 is irreversible-ish.** Once RPC bodies require a workspace context, rolling back means redeploying the old function definitions. Have a recovery DDL ready.
2. **Hardcoded user_department.** Must be removed BEFORE step 6 promotes workspace_members.department as the authoritative source. Existing intern usernames need to be migrated to membership.department in the seed migration (step 1).
3. **Backfill performance.** Step 2 adds a column and backfills all rows. On 19 tables with potentially millions of rows in the audit_logs table, do this in batches of 10k per transaction. Plan for a maintenance window or use `pg_batch` / `pg_repack`.
4. **External reviewers seeing too much.** Step 11 is where the EXTERNAL_REVIEWER role lands; its RBAC checks need a separate audit (see §9 below).
5. **Plan downgrades during paid pilot.** If a workspace drops from Enterprise to Free, suddenly some users exceed plan limits. Plan downgrade flow: 30-day grace period, then suspend writes.

### Rollback
- **Steps 1–3** are pure additions; revert by `drop column workspace_id` (slow on large tables but harmless).
- **Step 4** rolls back by re-deploying the previous function definitions and dropping the `active_workspace_id` column on `app_sessions`. Tested staging recovery procedure required.
- **Steps 5–14** roll back individually because each step is isolated.

---

## 9. Cross-tenant isolation tests (required before paid pilot opens to 2nd workspace)

Automated test list:

1. **Cross-tenant SELECT.** As user A in workspace 1, attempt every read RPC against a task/idea/template owned by workspace 2. Expect: empty result, never the actual row.
2. **Cross-tenant WRITE.** As user A in workspace 1, attempt every write RPC against a row owned by workspace 2 (by guessing IDs). Expect: 'Not allowed' or 'Not found'.
3. **Cross-workspace switching.** A user who belongs to both workspaces switches between them; verify the entire UI state (tasks, insights, audit logs) flips cleanly.
4. **Suspended workspace.** All RPCs return `Workspace suspended`. Read-only access optional in v2.
5. **External reviewer scoping.** External reviewer sees only the tasks explicitly assigned for review. Never sees other tasks, comments, or members.
6. **Client viewer scoping.** Client viewer sees only `client_visible=true` tasks (new column, step 11) and read-only aggregates. Never sees comments, proofs, members, or audit log.

These tests should run on every CI build once §6 step 4 lands.

---

## 10. What this plan deliberately does NOT cover

- **Database-per-tenant** (Option C in SAAS_READINESS_ROADMAP §2). Considered after the row-level model is proven at scale.
- **Workspace federation / SSO**. Single sign-on across workspaces is a separate identity-layer project.
- **Cross-workspace analytics** (e.g., aggregate dashboards for an MSP managing many client workspaces). Requires its own RPC surface that explicitly opts into multi-workspace reads.
- **Data export / takeout**. GDPR compliance ask; handled via a separate `export_workspace_data_rpc` + Stripe webhook on subscription cancel.

---

## 11. What's safe to do *tonight* without breaking single-company mode

Looking at the existing codebase, the following are no-op for the live product but lay groundwork:

- **Add `MULTI_ORG_IMPLEMENTATION_PLAN.md`** (this file) — done.
- **Update `BRAND_CONFIG`** with the additional fields (`supportEmail`, `demoModeBannerText`, etc.) — done. Per-workspace override remains a Phase 13 task (step 10 above).

Nothing else. The 19-table migration is explicitly off-limits tonight.

---

## 12. Verdict

The plan is workable, the schema is conservative, the rollout is staged. With one engineer working at normal pace, this is ~22 days of work to get to "open to second paying workspace." The biggest risk concentration is at step 4. Everything before it is safe; everything after it depends on it.

Schedule the work in week-long sprints, gate each sprint with browser QA, and do not under any circumstance attempt steps 5–11 before step 4 has been pilot-tested end-to-end.

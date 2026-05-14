# SaaS Readiness Roadmap — Omni Monitor

**Status:** Planning only. Not for implementation. No code, no SQL, no schema changes are produced by this document.

**Author:** Phase 10 planning pass.
**Last reviewed:** 2026-05-14.
**Master plan reference:** Phase 10 — SaaS Readiness Roadmap.

This document is a deliberate read-only roadmap. Per the master plan: "*This phase should be planned first, not implemented blindly. Do not implement SaaS migration until explicitly approved.*"

It captures what would change to take Omni Monitor from a single-tenant internal tool into a multi-tenant SaaS product, the order those changes should land in, and — most importantly — what should *not* be changed yet.

---

## 1. Current architecture snapshot (as built through Phase 9)

A precise picture of where we stand, because every SaaS decision branches off it.

- **Single tenant.** There is no organization / workspace / tenant concept anywhere in the schema. Every user, task, idea, template, recurring task, notification, AI insight, audit log, and review row belongs to *the* company. The seed user list in `schema.sql` and the hardcoded department mapping in `round4-task-workflow.sql:user_department` are concrete reminders.
- **Auth.** `private_user_from_token(p_token)` resolves a session token (in `app_sessions`) to an `app_users` row. There is no third party SSO, no email magic link, no password reset. CEO is bootstrapped via SQL seed.
- **Roles.** Fixed enum-style values in `app_users.role`: `CEO`, `FOUNDER`, `BOARD`, `INTERN`. Plus `TEAM_MEMBER` referenced once in the dormant React tree (App.jsx). RBAC is enforced inside every SECURITY DEFINER RPC by reading `me.role`.
- **RBAC layers in production today:**
  1. SQL: every RPC checks `me.role` and/or `user_department(me)`.
  2. Per-table: RLS is enabled on most tables with *no policies*, which means tables are unreachable with the anon key — all reads go through SECURITY DEFINER functions.
  3. Frontend: defense-in-depth filters in the role dashboards (Phase 6) and admin panel (Phase 9).
- **Storage of binary content.** Proof images are inline base64 data URIs in `proof_logs.screenshot_data_url`. There is no object store (no Supabase Storage bucket wired). Same for avatars (`app_users.avatar_data_url`).
- **AI inference.** `/api/ai-analysis.js` proxies to a per-deploy Ollama URL via env vars (`ENABLE_AI_ANALYSIS`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`). Rule-based fallback in `generate_ai_report_rpc` works without any inference.
- **Audit logs and activity_events** are *global* — one stream for the whole company. No tenant column.
- **Frontend.** Production UI is the single monolithic `src/main.jsx` (≈3,500 lines after Phases 6–9). Tabs are conditionally rendered inline. There is also a *dormant* router tree under `src/App.jsx + src/screens/`, per `FRONTEND_ARCHITECTURE.md`, that is not mounted.
- **Deploy target.** Vercel for the React + serverless API surface. Supabase Postgres for data, with anon key shipped to the client. RLS is the only thing standing between the anon key and the data.

This is the baseline that any multi-tenancy work has to land *on top of*.

---

## 2. Multi-tenancy: the core decision

Three architectures are realistic; the choice gates every other decision below.

### Option A — Shared database, shared schema, tenant_id everywhere ("row-level multi-tenancy")

Every tenant-owned row gains a `workspace_id uuid not null` column. Every RPC takes a workspace context (either implicit from the session, or as an explicit parameter) and filters by it. Every existing UNIQUE constraint gets `workspace_id` added.

- **Pros.** One schema to maintain. Cross-tenant analytics straightforward. Migrations apply once. Lowest infra cost.
- **Cons.** Every existing query/RPC must be rewritten. A single missed `where workspace_id =` is a cross-tenant leak. Tenant isolation depends entirely on application correctness.
- **Best for.** Many small workspaces (< 10 enterprise customers, > 100 teams), shared dashboards.

### Option B — Shared database, schema per tenant

Each tenant gets its own Postgres schema. Tables are duplicated per schema with `set search_path` per session.

- **Pros.** Strong logical isolation. Cross-tenant leak requires a schema-confusion bug, not a missing WHERE.
- **Cons.** Migrations have to apply N times. Tooling and ORM support is weaker. Schema bloat.
- **Best for.** Mid-count tenants who want stronger isolation but you don't want to pay for separate clusters.

### Option C — Database per tenant (or pooled clusters)

Each tenant gets a separate Supabase project / Postgres instance.

- **Pros.** Strongest possible isolation. Per-tenant scaling, per-tenant backups, per-tenant downtime. Compliance friendly (data residency).
- **Cons.** Most expensive. Provisioning automation needed. Cross-tenant queries are impossible — Omni cross-org analytics would need a separate warehouse.
- **Best for.** A small number of high-value enterprise customers; strict regulatory boundaries.

**Recommendation:** Option A (row-level `workspace_id`) for the first SaaS pass. It matches the maturity of the existing codebase (RPC-only access, RLS-protected tables) and gives the cheapest path to actual revenue. Option C is a credible later step for enterprise customers — same RPC contract, different database under the hood.

The rest of this document assumes Option A unless otherwise stated.

---

## 3. Schema changes (what would change, not how)

### 3.1 New tables (sketched at the conceptual level only — NOT for execution)

- **`workspaces`** — id, slug, display_name, plan_tier, status (`active`, `suspended`, `trial`), created_at, billing_email, brand_logo_url, brand_primary_color (for white-labeling).
- **`workspace_members`** — workspace_id, user_id, workspace_role (`OWNER`, `ADMIN`, `MEMBER`, `EXTERNAL_REVIEWER`, `CLIENT_VIEWER`), invited_by, joined_at, suspended_at. A single `app_users` row can belong to many workspaces (or not, depending on policy — see §6).
- **`workspace_invites`** — id, workspace_id, email, role, token, expires_at, accepted_at. Email-based invite flow with revocable tokens.
- **`workspace_plans`** — plan_tier, limits (max_users, max_active_tasks, max_storage_mb, ai_enabled, retention_days). Read by an enforcement helper.
- **`workspace_usage`** — rolling counters used to enforce plan_limits without re-counting on every action.
- **`workspace_audit_logs`** — *optional*. The simpler choice is just to add a `workspace_id` column to the existing `audit_logs` and filter by it; the harder choice (full isolation, per-§9) is a separate table.

### 3.2 Existing tables that must gain `workspace_id`

Every tenant-owned table. As-of Phase 9, that is:

```
app_users, app_sessions, tasks, time_logs, proof_logs, activity_events,
audit_logs, notifications, ideas, task_templates, recurring_tasks,
recurring_task_instances, task_reviews, ai_providers, ai_insights,
ai_report_templates, ai_report_runs, ai_work_notes
```

This is roughly 19 tables. The migration risk for this is real (see §11).

### 3.3 What changes in the *existing* RPCs

- Every RPC's first action becomes: resolve `me`, then **resolve the active workspace** (either from a session-bound workspace or an explicit `p_workspace_id`), then check that `me` is a member of that workspace, then add `where workspace_id = active_ws` to every SELECT/UPDATE/DELETE.
- The role-check pattern shifts: `me.role` is no longer enough. Authorization becomes a combination of `app_users.role` (system role, e.g. `CEO`) and `workspace_members.workspace_role` (per-tenant role, e.g. `OWNER`). The current `CEO` shorthand has to be reframed as "workspace_role in ('OWNER', 'ADMIN')" inside a tenant.

### 3.4 Hardcoded data that has to come out

- `round4-task-workflow.sql:user_department()` hardcodes Omni's actual intern usernames into the department mapping. This is fine for a single-tenant internal product but is the first thing to remove the day a second workspace exists.
- The seed inserts in `schema.sql` and the AI provider seeds in `round20` will all need to become per-workspace bootstrap routines.

---

## 4. Multi-tenant RBAC

### 4.1 Two-level role model

```
System level         Workspace level
─────────────        ──────────────────
SUPER_ADMIN          OWNER             (full workspace control + billing)
SUPPORT              ADMIN             (everything except billing)
USER                 MEMBER            (CEO/FOUNDER/INTERN-equivalent today)
                     EXTERNAL_REVIEWER (proof review only, scoped)
                     CLIENT_VIEWER     (read-only progress view)
```

Today's `app_users.role` collapses both levels; it gets split.

### 4.2 Defense in depth

- **Session token must encode active workspace.** Either by storing `active_workspace_id` on `app_sessions` (preferred — invalidated on switch) or by requiring an explicit `p_workspace_id` on every RPC.
- **`private_user_from_token` evolves** into `private_user_and_workspace_from_token(p_token)` returning `(app_users, workspaces, workspace_role)`.
- Every helper that currently asks "is this user CEO?" gets rephrased as "is this user OWNER or ADMIN *in workspace X*?".
- The existing pattern of `if me.role <> 'CEO' then ...` becomes the most error-prone code in the migration. A repo-wide audit + grep gate is mandatory before launch.

### 4.3 RLS posture

The current "RLS enabled, no policies, all access via RPC" pattern stays. But Supabase Storage (when added — see §5) gets per-workspace bucket-prefix policies, because storage URLs are exposed to the client and RLS-via-RPC doesn't apply there.

---

## 5. Client portals + external reviewers

Two new workspace roles, each with their own constraints.

### 5.1 EXTERNAL_REVIEWER

- Designed for someone outside the company who reviews intern proofs on behalf of a client.
- Can see: only tasks assigned to them, only the proof history of those tasks, only the reviewer comments thread.
- Cannot see: other workspace members, rankings, AI insights, audit logs, strike management.
- Cannot do: create/edit/assign tasks, change deadlines, apply strikes, add interns.
- Auth path: invited via `workspace_invites` with a magic link; no full Omni login.

### 5.2 CLIENT_VIEWER

- Designed for a client of the company to watch progress on agreed deliverables.
- Can see: a curated subset of tasks (probably gated by a `client_visible` flag on tasks), aggregate status, completion percentage, milestone view.
- Cannot see: comments, proofs (unless explicitly shared), member names beyond a per-workspace whitelist.
- Cannot do: anything write-side.
- Auth: same invite flow, but the UI is a stripped-down read-only "client portal" route (likely `/portal/:workspace`).

### 5.3 UI implications

- The active production UI in `src/main.jsx` currently assumes "every authenticated user sees the full app shell." That collapses for external/client roles. A new top-level route + a separate, much smaller, app shell is needed. Almost certainly the right time to migrate to the dormant `src/App.jsx + src/screens/` tree noted in `FRONTEND_ARCHITECTURE.md` — see §13.

---

## 6. White-labeling

What "white-label" actually means here, in increasing levels of effort:

- **L1 — Logo + accent color.** Per-workspace `brand_logo_url` and `brand_primary_color` on `workspaces`. CSS custom properties driven from those. About one day of work after the multi-tenancy migration is done.
- **L2 — Custom domain.** Customer can serve the app at `monitor.theirco.com`. Requires Vercel custom-domain wiring per workspace plus a workspace-from-host resolver at the edge.
- **L3 — Full theming.** Light/dark per workspace, typography choice, side-nav variants. Requires a real theming system; the current single `styles.css` would need to become a tokenized system.
- **L4 — Custom email sender + custom invite URLs.** Requires SES/Postmark per-workspace identity setup. Out of scope for v1.

**Recommendation:** L1 only in the first SaaS release. L2 in the second.

---

## 7. Billing readiness

The current system has no concept of money, plans, or limits. To get billable:

### 7.1 Plans

- `workspace_plans` table with at least three tiers: `free`, `team`, `enterprise`.
- Each tier defines: `max_active_users`, `max_active_tasks`, `max_storage_mb`, `ai_enabled` (boolean), `audit_retention_days`, `external_reviewers_allowed` (count), `client_portal_allowed` (bool), `custom_branding_level` (0/1/2/3).
- A workspace's current plan lives on `workspaces.plan_tier`; usage is tracked in `workspace_usage`.

### 7.2 Plan enforcement

- A small `can_consume(workspace_id, resource, n) → boolean` helper, called by every relevant RPC.
- Soft-limit pattern: at 90% of a limit, surface a UI warning. At 100%, the next write fails with a friendly "upgrade required" error.
- No silent enforcement bypasses. Even an OWNER can't exceed the plan without changing the plan.

### 7.3 Stripe (or equivalent) integration

- Webhook endpoint (`/api/billing/webhook.js`) updates `workspaces.plan_tier` and `workspaces.status` on Stripe events.
- Customer ID and subscription ID stored on `workspaces`.
- A `/billing` route inside the workspace owner UI links to the Stripe customer portal for plan changes and invoices.
- *Important non-implementation detail:* PCI is fully delegated to Stripe — no card data ever touches Supabase.

### 7.4 Trial + suspension

- New workspaces start as `status='trial'` with a 14-day expiry.
- On expiry without payment: `status='suspended'`. The workspace becomes read-only; no writes accepted; all RPCs return a clear suspended error.
- A nightly cron checks for expired trials.

---

## 8. Workspace invites

- Owner/Admin creates an invite by email + workspace_role. Invite row gets a single-use token and an expiry (default 7 days).
- Email sent via SES/Postmark with a link to `/invite/:token`. (Email sender is itself a Phase 10 dependency — currently the app sends no email at all.)
- On click: if the user already has an `app_users` row, the system asks them to confirm and adds the membership. If not, they go through a signup form scoped to this invite.
- An invite token is destroyed on acceptance. A separate "audit\_log" event (`INVITE_ACCEPTED`) is written.
- Admins can revoke unaccepted invites and remove existing members. Removing the last `OWNER` is forbidden.

---

## 9. Audit separation per workspace

Two viable patterns, both should be evaluated:

### 9.1 Single audit_logs table with workspace_id column (recommended for v1)

- Add `workspace_id uuid not null` to `audit_logs`. Backfill the historic single-tenant rows to a "legacy" workspace id.
- Add `(workspace_id, created_at desc)` index.
- `get_audit_logs_rpc` adds a workspace filter; cross-workspace access requires `SUPER_ADMIN`.

### 9.2 Per-workspace audit_logs partition (Postgres declarative partitioning)

- `audit_logs` becomes a partitioned table by `workspace_id`. Each workspace gets its own partition.
- Stronger physical isolation, better drop-to-zero retention (drop partition vs DELETE).
- More moving parts, more migration risk.

**Recommendation:** §9.1 in v1. Revisit §9.2 once the largest workspace exceeds ~10M audit rows or a regulator asks.

---

## 10. Data isolation guarantees

Concrete promises that the SaaS launch should be able to make:

1. **No cross-workspace data is ever returned by any SECURITY DEFINER function.** Enforced by a repo-wide test: every RPC body must reference `workspace_id` in its WHERE clauses *and* must check membership.
2. **Every user-uploaded file lives at a path that begins with `workspaces/{workspace_id}/`** and is gated by a Storage policy that rejects mismatches. (Once Supabase Storage is adopted — see §13.)
3. **Per-workspace deletion is single-statement.** A `delete_workspace_rpc` triggers a single transactional cascade across all 19+ tenant tables. No orphaned rows.
4. **Logs do not contain other workspaces' identifiers.** The audit log RPC strips `meta` fields that reference IDs the caller can't see.

These need automated tests before the first paying customer.

---

## 11. Migration risks (the ones that scare me)

In rough order of severity:

1. **Adding `workspace_id` to 19 tables, backfilling, and making it NOT NULL** is a multi-step migration. Done wrong, it locks every table for minutes during business hours. Recommended sequence: add nullable column → backfill in batches → add index → enforce NOT NULL → add FK constraint. Each step must be reversible.
2. **The bootstrap `app_users` row for the CEO is hardcoded in `schema.sql:93`.** That row exists in a single-tenant world. The migration needs to invent a "legacy" workspace for it without breaking the existing session token.
3. **`user_department` hardcodes intern usernames.** Until removed and replaced with per-workspace department membership, no second workspace can have interns at all.
4. **RLS-protected tables with no policies** are fine today because everything goes through SECURITY DEFINER functions. The moment Supabase Storage is added and the anon key is used to access it, anything that doesn't have a workspace-aware policy is a leak.
5. **Frontend monolith.** `src/main.jsx` was built assuming one set of users. Splitting client/external portals from the main app shell is itself a high-touch refactor; doing it inside the monolith is asking for regressions. Migrating to the dormant `src/App.jsx + src/screens/` tree first will probably be required.
6. **AI provider config bleeds across workspaces.** `ai_providers` today is a single shared row. The Ollama URL one customer points at must never be tried for another customer's report. Either move the AI config to per-workspace, or document clearly that "AI is global to the deployment."
7. **Audit log retention.** Today there is no retention policy. A SaaS plan may impose 90 days for free tier and 7 years for enterprise. The retention enforcer is its own subsystem.
8. **Cron jobs (`generate_due_tasks_rpc`) currently run unscoped.** Need to be either per-workspace or to iterate workspaces internally. If a workspace is suspended, its cron should be skipped.
9. **No email-sending infrastructure exists yet.** The invite flow requires it. Choosing a provider (SES vs Postmark vs Resend) is its own decision with cost implications.
10. **External-reviewer + client-viewer routes are entirely new UI.** They are NOT a feature flag on the existing app shell; they need their own route tree.

---

## 12. Rollout order (suggested)

Each step is gated by passing tests + a code review before the next starts. Nothing here is for implementation today.

```
0.   Land a workspace_id audit script (test-only) that scans every RPC
     for missing tenant filters. Use it as a CI gate.

1.   New tables: workspaces, workspace_members, workspace_invites.
     Create a single seeded "Omnimate" workspace. No FK changes yet.

2.   Add nullable workspace_id to all 19 tenant tables. Backfill all
     existing rows with the Omnimate workspace id.

3.   Add indexes (workspace_id, …) on every tenant table. No NOT NULL
     yet.

4.   Update every RPC to read workspace_id from the session and filter
     by it. Tests must verify: (a) cross-tenant SELECT returns empty,
     (b) cross-tenant write fails.

5.   Add NOT NULL + FK constraints on workspace_id. Now the column
     can't be skipped.

6.   Split app_users.role into system_role + workspace_role on
     workspace_members. Migrate every helper that says `me.role = 'CEO'`
     to ask about workspace_role.

7.   Add workspace_invites flow + email sending. First invite works
     end-to-end inside the seeded Omnimate workspace.

8.   Add workspace_plans + workspace_usage + enforcement helpers.
     Plans are stub'd (everyone on Enterprise) until billing lands.

9.   Stripe integration. Trial → paid → suspended state machine.

10.  L1 white-label (logo + accent).

11.  External reviewer + client viewer roles + the new portal app shell.
     This is when the dormant src/App.jsx tree gets activated.

12.  Per-workspace audit retention enforcement.

13.  L2 white-label (custom domain).

14.  (Optional) Move to Option B or C database isolation for enterprise
     plan customers.
```

Anything before step 4 is reversible. After step 4, rollback is painful.

---

## 13. What should NOT be changed yet

These are the things to actively *resist* touching until SaaS work is formally approved:

- **The dormant `src/App.jsx + src/screens/` tree.** It will become the SaaS app shell, but activating it now would mean two production paths to maintain. Per `FRONTEND_ARCHITECTURE.md`: do not migrate the entry path without a planned migration.
- **The hardcoded `user_department` mapping.** It's load-bearing for the current single-tenant product. Removing it before workspace membership exists would break the live app.
- **The `audit_logs` table shape.** Adding a `workspace_id` column out of order would silently break the Phase 9 admin RPCs.
- **The single `notifications.kind` CHECK constraint.** Phase 8 deliberately left it alone. If SaaS work adds new kinds (e.g. `WORKSPACE_INVITED`), it must be a single coordinated migration — not a piecemeal expansion across phases.
- **The Ollama / AI provider seed rows.** `ai_providers` is single-tenant today. Don't add multi-tenancy half-way to AI config until §11.6 is decided.
- **`schema.sql`'s seed INSERTs for app_users.** Those rows are how the live system bootstraps the CEO. Until the workspace bootstrap routine exists, removing them breaks login.
- **The `/api/ai-analysis.js` env-var contract.** Vercel deploys depend on `ENABLE_AI_ANALYSIS`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`. SaaS work should add per-workspace AI config alongside, not replace the env-var path.
- **The `tasks` table's lack of `updated_at`.** Phase 9's "stuck task" detection works around it via `activity_events`. Adding `updated_at` mid-SaaS-migration would invalidate that workaround and the diagnostics RPC; do it as its own deliberate step or not at all.
- **The dormant `AuthContext.jsx` notification polling** in `src/context/AuthContext.jsx`. It is currently inactive because the active main.jsx doesn't use it. Activating it accidentally during SaaS work would resurrect a polling loop that was deliberately not enabled.

---

## 14. Open questions for the project owner

These are decisions that block the next planning iteration. Resolve them before any code is written.

1. **Pricing model.** Per-seat? Per-workspace? Per-active-task? This choice changes the schema design for `workspace_usage`.
2. **Free tier or no free tier?** A free tier means stricter limits + abuse defense.
3. **Self-serve signup vs sales-only onboarding?** Determines whether `/signup` exists at all.
4. **Region requirement (EU vs US data residency)?** Pushes toward Option B/C if yes.
5. **SSO / Google login?** Adds an auth provider and a user-merging story.
6. **Email provider choice.** SES vs Postmark vs Resend. Affects invite UX.
7. **Existing internal usage continuity.** Does Omnimate's current single-tenant deployment migrate into "Workspace #1" of the SaaS product, or stay separate? This determines whether the rollout is in-place or a fresh deploy.
8. **AI per-workspace vs deployment-wide.** Do we want each customer to bring their own Ollama URL, or is AI a deployment-level setting? §11.6.
9. **Compliance scope.** SOC 2? HIPAA? GDPR DPA? These dictate audit log retention, encryption-at-rest knobs, and access-review cadence.
10. **What's the first customer.** A real signed customer pulls some of these decisions into focus and lets us cut scope on others.

---

## 15. Next recommended actions

In order, before any SaaS code is touched:

1. Project owner reads this document and answers §14 — even a "TBD" with a target date is useful.
2. Project owner picks Option A / B / C (§2) and writes the choice as a one-line commit message into this file.
3. A separate planning pass produces a detailed schema diff: the exact ALTER TABLE statements for step 2 of §12, with backfill scripts. Still no execution.
4. CI gate from §12 step 0 lands. Until grep can prove every RPC is workspace-aware, no production migration runs.
5. Then — and only then — Phase 10 transitions from planning into implementation, and we cut a fresh phase plan modeled on Phases 1–9.

---

*End of planning document. No code, schema, or runtime change is implied by this file. Edits to this document are welcome; edits to the codebase based on this document are not, until Phase 10 implementation is explicitly approved.*

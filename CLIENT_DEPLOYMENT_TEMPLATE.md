# Client Deployment Template — Omni Monitor

End-to-end guide for deploying Omni Monitor for a new client. By the end of this guide you will have a branded, configured, production-grade single-client deployment.

**Time required:** ~3 hours (excluding waiting for DNS, AI provider account creation, and customer-side approvals).

**What this gives you:** a working Omni Monitor instance, fully branded for the client, with their roles and departments, their AI provider, and their first users provisioned. Single-client mode — one tenant, one database. SaaS multi-tenant is a separate roadmap item.

**What this does NOT give you:** billing, multiple customer workspaces in one deployment, custom domains beyond Vercel's built-in support, or any feature not already present in Phases 1–13.

---

## 0. Prerequisites

Have these in hand before you start. Use `CLIENT_INTAKE_FORM.md` to gather them from the client.

- [ ] Client company name, tagline, logo text (2-character abbreviation).
- [ ] Industry / workspace label (e.g. "Operations", "Hospital Ops", "Sales Team").
- [ ] Department names (the app ships with two: frontend, backend; these are display labels — see §5).
- [ ] Role names (CEO/Founder/Board/Intern — display labels override is fine; DB enum stays).
- [ ] List of users (name, username, role, title, department).
- [ ] AI strategy: OpenAI (with API key) / hosted Ollama / local Ollama / mock.
- [ ] Support contact for the client (email, optional URL).
- [ ] Domain: subdomain of `vercel.app` for now, or custom domain.

---

## 1. Repository setup

```bash
# Clone (or fork) the repo for this client
git clone <repo-url> omni-<client-slug>
cd omni-<client-slug>

# Verify build works as-is (Omnimate defaults)
npm install
npm run build      # expect: 1771 modules, 0 errors
```

---

## 2. Supabase project

### 2.1 Create a new Supabase project

1. https://app.supabase.com → New project.
2. Pick a region close to the client.
3. Note the **Project URL** and **anon public key**.

### 2.2 Apply migrations in order

In the Supabase dashboard SQL editor, run each file's contents in this order:

```
1.  schema.sql
2.  strike-system.sql
3.  fix-strikes-score.sql
4.  idea-board.sql
5.  delete-task-rpc.sql
6.  founder-intern-management.sql
7.  round3-profile-notifications.sql
8.  round4-task-workflow.sql
9.  round5-product-audit.sql
10. round6-add-developer-interns.sql
11. round7-status-permissions.sql
12. round8-task-rbac-moderation.sql
13. round9-dashboard-performance.sql
14. round10-department-assignment-rbac.sql
15. round11-stable-get-tasks-rpc.sql
16. round12-fast-get-tasks-rpc.sql
17. round13-recurring-rankings-ai.sql
18. round14-task-column-rpc.sql
19. round15-enterprise-task-view-rpc.sql
20. round16-task-review-status-values.sql
21. round17-enterprise-review-workflow.sql
22. round18-timeline-activity-feed.sql
23. round19-task-templates-recurring-upgrade.sql
24. round20-ai-insights-reporting.sql
25. round21-audit-logs-system-health.sql
26. round22-security-audit-hardening.sql
27. round23-audit-log-completeness.sql
```

After each, verify no errors. Sanity check at the end:

```sql
-- Confirm at least one user, all roles, and the audit table is present.
select count(*) from app_users;
select distinct role from app_users;
select count(*) from audit_logs;
```

### 2.3 Replace the seeded Omnimate CEO with the client's CEO

`schema.sql` ships a seeded CEO that's Omnimate-specific. Replace it with the client's CEO:

```sql
-- Replace placeholder CEO with the real one (use the username the client wants)
update app_users
set name = '<client CEO name>',
    username = '<client.ceo.username>',
    title = '<client CEO title>',
    password_hash = crypt('<temporary-strong-password>', gen_salt('bf'))
where username = 'yusuf_ceo';   -- the seeded Omnimate placeholder

-- Add other admins
insert into app_users (name, username, password_hash, role, title)
values
  ('<Person Name>', '<person.username>', crypt('<temp-pw>', gen_salt('bf')), '<ROLE>', '<title>')
;
```

Roles allowed: `'CEO'`, `'FOUNDER'`, `'BOARD'`, `'INTERN'`. Departments derive from title — include the word "frontend" or "backend" in the title, or use the `user_department()` mapping in `round4-task-workflow.sql:user_department` (engineering can extend that mapping in a follow-up migration when you add users who don't fit the existing buckets).

Tell the client to change their password on first login via `/profile`.

---

## 3. Vercel project

### 3.1 Connect the repository

1. https://vercel.com/new → import your client's fork/branch.
2. Framework preset: Vite. Build command: `npm run build`. Output: `dist`.
3. Do NOT deploy yet — set env vars first.

### 3.2 Set Supabase env vars (REQUIRED)

In Vercel project settings → Environment Variables:

```
VITE_SUPABASE_URL       = <from §2.1>
VITE_SUPABASE_ANON_KEY  = <from §2.1>
```

### 3.3 Set AI env vars (pick one strategy)

See `AI_PRODUCTION_READINESS.md` for the full matrix. Short version:

| Client wants… | Env vars to set |
| --- | --- |
| OpenAI (cheapest, recommended) | `AI_PROVIDER=openai`, `OPENAI_API_KEY=sk-...`, optional `OPENAI_MODEL=gpt-4o-mini` |
| Hosted Ollama (privacy-sensitive) | `AI_PROVIDER=ollama`, `ENABLE_AI_ANALYSIS=true`, `OLLAMA_BASE_URL=https://ollama.client.example.com`, `OLLAMA_MODEL=...` |
| No AI (start with mock) | leave all AI vars empty |

### 3.4 Set CLIENT_* branding env vars

Use the client's answers from `CLIENT_INTAKE_FORM.md`. Every variable below has an Omnimate default — set the ones you want to override, leave the rest blank.

Minimum recommended set for a client deployment:

```
VITE_CLIENT_COMPANY_NAME      = <Client Co>
VITE_CLIENT_PRODUCT_NAME      = <Client Co> Monitor       (or whatever they want it called)
VITE_CLIENT_LOGO_MARK         = <2-char abbreviation>
VITE_CLIENT_TAGLINE           = <one-line product tagline>
VITE_CLIENT_INDUSTRY_LABEL    = <Operations / Hospital Ops / Sales / etc.>
VITE_CLIENT_AI_ASSISTANT_NAME = <client's preferred AI name>
VITE_CLIENT_SUPPORT_EMAIL     = <client's IT/support email>
VITE_CLIENT_COPYRIGHT_OWNER   = <Client Co>
```

Optional polish:

```
VITE_CLIENT_DEPT_FRONTEND_LABEL = <e.g., "Operations">
VITE_CLIENT_DEPT_BACKEND_LABEL  = <e.g., "Engineering">
VITE_CLIENT_ROLE_CEO_LABEL      = <e.g., "Director">
VITE_CLIENT_ROLE_INTERN_LABEL   = <e.g., "Team Member">
VITE_CLIENT_LOGIN_DESCRIPTION   = "Internal workspace for the <Client Co> team."
```

### 3.5 Deploy

Click Deploy in Vercel. Wait for the build to complete.

---

## 4. First sign-in

1. Hit the deployed URL in a private window.
2. Log in as the CEO created in §2.3.
3. NavBar — confirm the brand mark, product name, and tagline reflect the client.
4. AI mode pill should be green ("AI Active") if you configured a real provider, neutral ("Mock Mode") otherwise.
5. `/home` → confirm role-specific dashboard renders.
6. `/more` → confirm Reports panel and Admin diagnostics panel (CEO-only) render.

Walk through `INDUSTRY_READY_QA_CHECKLIST.md` end to end before handing the URL to the client.

---

## 5. What you can change with config alone (no code edit)

Every UI string visible to end users. The full list of variables is in `.env.example` under the `CLIENT BRANDING / CONFIG` section. Common changes per client:

- Login screen heading, tagline, description.
- NavBar product name, logo mark.
- AI Executive Note assistant name.
- Department labels.
- Role labels.
- Finance/project placeholder text.
- Support email and URL.
- Demo banner text (for pre-sale demos).

---

## 6. What requires a code/SQL change

The configuration system covers UI strings only. Anything below requires engineering involvement:

- **New department beyond frontend/backend** (e.g. adding 'design' / 'marketing'). Requires extending `user_department()` in `supabase/round4-task-workflow.sql` and assigning users by title or username. Discuss with engineering before promising the client this is configurable.
- **New role beyond CEO/FOUNDER/BOARD/INTERN.** The role enum is checked in dozens of RPCs. Adding a new role is a focused engineering task.
- **Workflow changes** (e.g., requiring two-person review approval). Touches `review_task_rpc` in `round17`. Not in client config.
- **Custom integrations** (Slack, Teams, email digest). Not built — see `BILLING_AND_LIMITS_PLAN.md` for the integration backlog.
- **Custom AI prompts** (the system prompt for the AI Executive). Today lives in `api/ai-analysis.js:buildPrompt`. Can be customised but requires a code edit.
- **Schema changes** (adding columns to tasks, custom fields). Requires a new SQL migration.

---

## 7. What NOT to change for a client deployment

Touching these will break the app. Engineering only.

- `TOKEN_KEY` in `src/main.jsx` — localStorage key for session tokens. Renaming invalidates every existing session.
- `LEGACY_TOKEN_KEY` — kept for backward compat with old Omnimate sessions.
- Any of the `supabase/round*.sql` files. The migrations are append-only by design.
- The CSS variable system in `src/styles.css` lines 1814–1867 (the active light-theme variables that everything else builds on).
- `user_department()` mappings without coordinating with engineering — the hardcoded usernames there belong to the original Omnimate team and are only relevant if you reuse the same DB.

---

## 8. Post-deployment QA

Walk through `INDUSTRY_READY_QA_CHECKLIST.md`. It's the on-screen tick list specifically focused on brand replacement + role flows + RBAC for a new client deployment.

---

## 9. Handover to the client

When QA is green:

1. Send the client the deployed URL.
2. Send each user their username + a temporary password. Ask them to set a real one via `/profile` on first login.
3. Share `EMPLOYEE_USER_GUIDE.md` (rebrandable — it currently uses Omnimate naming; the version you forked into the client's repo can be customised).
4. Share `ADMIN_ONBOARDING_GUIDE.md` with the client's CEO/admin.
5. Schedule a 30-minute training call.
6. Schedule a check-in at +7 days and +30 days.

---

## 10. Known constraints (be honest with the client)

Disclose these during the sales process so there are no surprises after deployment:

- **Single-tenant.** One Vercel + Supabase deployment per client. Multi-org SaaS is a planned future phase.
- **No payment / subscription.** Billing is handled manually (Stripe link emailed to the client, or invoiced via your ops process).
- **Audit log retention is unlimited.** No automated retention enforcement yet.
- **AI is advisory only.** No auto-disciplinary actions. The system never strikes or escalates without a human pressing a button.
- **Mobile is responsive but not a PWA.** No installable home-screen app. Browser only.
- **No SSO / SAML.** Username/password auth via Supabase. Self-serve password reset is not yet implemented — the client's CEO resets passwords manually via the dashboard.

---

## 11. Pre-flight checklist

Tick before deploy:

- [ ] Supabase project created, all 27 migrations applied.
- [ ] Seeded Omnimate CEO replaced with the client's CEO.
- [ ] All admin users created in `app_users`.
- [ ] Vercel project linked to the repo.
- [ ] All required env vars (`VITE_SUPABASE_*`) set on Vercel.
- [ ] Client branding env vars (`VITE_CLIENT_*`) set per `CLIENT_INTAKE_FORM.md`.
- [ ] AI provider env vars set (or deliberately left blank for mock mode).
- [ ] Vercel deploy successful — no build errors.
- [ ] AI mode pill renders correctly in NavBar.
- [ ] CEO login works.
- [ ] At least one task created in `/tasks` and reviewed end to end.
- [ ] Admin diagnostics (`/more` → Show) loads without errors.
- [ ] `INDUSTRY_READY_QA_CHECKLIST.md` fully ticked.
- [ ] Client trained.
- [ ] Domain configured (if custom).

When everything is green, the deployment is live for the client.

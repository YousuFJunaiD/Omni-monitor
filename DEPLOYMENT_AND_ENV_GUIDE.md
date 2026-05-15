# Deployment & Environment Guide — Omni Monitor

For engineers deploying or operating Omni Monitor. If you want to *use* the app, see `EMPLOYEE_USER_GUIDE.md`. If you want to *onboard a workspace*, see `ADMIN_ONBOARDING_GUIDE.md`.

---

## 1. Stack

- **Front-end** — React 19 (via Vite + Rolldown). Production entry: `src/main.jsx` → `index.html`. Built to static assets, deployed on Vercel.
- **Back-end** — Supabase Postgres. No custom server beyond Vercel's `/api/*` serverless routes. All app data lives in Supabase; every read/write goes through a SECURITY DEFINER RPC.
- **AI proxy** — Vercel serverless function at `/api/ai-analysis`. Talks to OpenAI-compatible or Ollama-compatible endpoints. See `AI_PRODUCTION_READINESS.md`.

This is a serverless, monolithic-front-end architecture. There is no separate backend service to operate.

---

## 2. Required environment variables

Set these in your hosting environment (Vercel project settings → Environment Variables). For local dev, copy `.env.example` to `.env.local` and fill in.

### 2.1 Required at build time

| Var | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL: `https://YOUR-PROJECT.supabase.co`. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Anon key from Supabase project settings. NOT the service role key. |

Without these, the build will still complete but the app will refuse to start at runtime with a clear error.

### 2.2 Optional — AI provider

See `AI_PRODUCTION_READINESS.md` §3 for the full matrix. The short version:

| Setup | Vars |
| --- | --- |
| OpenAI (recommended) | `OPENAI_API_KEY=sk-...`, optionally `OPENAI_MODEL`, `OPENAI_BASE_URL` |
| Self-hosted OpenAI-compatible (Groq, vLLM, etc.) | `OPENAI_API_KEY=...`, `OPENAI_BASE_URL=https://...`, `OPENAI_MODEL=...` |
| Hosted Ollama | `AI_PROVIDER=ollama`, `ENABLE_AI_ANALYSIS=true`, `OLLAMA_BASE_URL=https://your-ollama.example.com`, `OLLAMA_MODEL=deepseek-r1:8b` |
| Local Ollama (dev only) | `AI_PROVIDER=ollama`, `ENABLE_AI_ANALYSIS=true`, `OLLAMA_BASE_URL=http://192.168.x.x:11434`, `OLLAMA_MODEL=deepseek-r1:8b` |
| No AI (mock only) | leave all AI vars empty / unset |

The auto-picker chooses OpenAI if `OPENAI_API_KEY` is set, then Ollama if `ENABLE_AI_ANALYSIS=true`, then mock. `AI_PROVIDER` explicitly overrides if you want to force a specific provider.

---

## 3. First-time deployment (Vercel + Supabase)

### 3.1 Provision Supabase

1. Create a new Supabase project at https://app.supabase.com.
2. Project Settings → API → copy the **Project URL** and **anon public key**. These become `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. SQL Editor → run each `supabase/*.sql` file IN ORDER, starting with `schema.sql`. The order is:
   - `schema.sql`
   - `strike-system.sql`
   - `fix-strikes-score.sql`
   - `idea-board.sql`
   - `delete-task-rpc.sql`
   - `founder-intern-management.sql`
   - `round3-profile-notifications.sql`
   - `round4-task-workflow.sql`
   - `round5-product-audit.sql`
   - `round6-add-developer-interns.sql`
   - `round7-status-permissions.sql`
   - `round8-task-rbac-moderation.sql`
   - `round9-dashboard-performance.sql`
   - `round10-department-assignment-rbac.sql`
   - `round11-stable-get-tasks-rpc.sql`
   - `round12-fast-get-tasks-rpc.sql`
   - `round13-recurring-rankings-ai.sql`
   - `round14-task-column-rpc.sql`
   - `round15-enterprise-task-view-rpc.sql`
   - `round16-task-review-status-values.sql`
   - `round17-enterprise-review-workflow.sql`
   - `round18-timeline-activity-feed.sql`
   - `round19-task-templates-recurring-upgrade.sql`
   - `round20-ai-insights-reporting.sql`
   - `round21-audit-logs-system-health.sql`
4. Verify by running `select count(*) from app_users;` — should return at least 1 (the seeded CEO).

### 3.2 Configure Vercel

1. Connect the GitHub repository to a new Vercel project.
2. Framework preset: Vite. Build command: `npm run build`. Output: `dist`.
3. Environment Variables: paste in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Add AI vars if relevant.
4. Deploy.
5. Hit the deployed URL. The login page should render.

### 3.3 Bootstrap your CEO

If the seeded CEO from `schema.sql` doesn't work for your customer (different name / password), reset it via Supabase SQL editor:

```sql
update app_users
set name = 'Your CEO Name',
    password_hash = crypt('your-new-password', gen_salt('bf'))
where username = 'yusuf_ceo';   -- the seeded username; rename or replace
```

Or insert a fresh one:

```sql
insert into app_users (name, username, password_hash, role, title) values
  ('Your CEO Name', 'newceo', crypt('temp-password', gen_salt('bf')), 'CEO', 'CEO');
```

### 3.4 Verify deployment health

End-to-end smoke test:

1. Log in as CEO.
2. NavBar — AI mode pill should render (green / amber / grey / red depending on AI config).
3. `/home` — Executive Note card renders.
4. `/tasks` — empty list with a "Create task" button.
5. `/more` → "Show" admin diagnostics — six stat cards populate.

If all five pass, the deployment is healthy.

---

## 4. Updating production

```bash
git pull origin main
git push   # Vercel auto-deploys
```

For SQL changes:

1. Pull the new migration file.
2. Open Supabase dashboard → SQL editor.
3. Paste and Run.
4. **Always do this BEFORE the Vercel deploy lands**. If the front-end references a function that doesn't exist yet, users hit RPC errors.

Recommended sequence for any SQL-paired release:

```
1. Apply migration in staging Supabase.
2. Deploy front-end to a Vercel preview.
3. QA on preview.
4. Apply migration in production Supabase.
5. Promote preview to production.
6. Confirm AI mode pill, /home, /more.
```

---

## 5. Configuration knobs

Most operational knobs are env vars. The remaining live in code:

### 5.1 BRAND_CONFIG (top of `src/main.jsx`)

Edit and redeploy. Fields:

- `companyName`, `productName`, `logoMark`, `tagline`, `appHeading` — visible in NavBar + login.
- `aiAssistantName` — the title above the Executive Note.
- `defaultDepartments` — `{frontend, backend}` display labels.
- `financePlaceholderText` — text on the CEO finance placeholder card.
- `workspaceLabel` — fallback label when a user has no title.
- `supportEmail`, `supportUrl` — referenced in user-facing docs.
- `demoModeLabel`, `demoModeBannerText` — non-empty value shows a top-of-app banner. Use for demo workspaces.
- `loginDescription` — under the login form's company name.
- `emptyDashboardHint` — shown on empty `/home` states.
- `copyrightOwner` — footer copyright string.

### 5.2 Hardcoded department mapping (`supabase/round4-task-workflow.sql:user_department`)

Sets which usernames are "frontend" vs "backend". Edit and re-run the migration; idempotent. Replaced by a proper `app_users.department` column in a future phase.

### 5.3 Strike thresholds

3 strikes → warning UI; 5 strikes → escalation styling. Hardcoded in component CSS class names. Edit `src/main.jsx` `StrikeBadge` and search for `strikes >= 3` if you need a different threshold.

---

## 6. Backups + disaster recovery

- Supabase takes automatic daily snapshots by default (Free tier: 7-day retention; Pro tier: longer).
- For paid pilot, upgrade Supabase to Pro and configure 14-day point-in-time recovery.
- Document the restore procedure in your team runbook. Test it quarterly.
- Vercel preserves deployment history; rolling back the front-end is one click in the Vercel dashboard.

---

## 7. Incident response

When the app is down:

1. **Vercel deployment status** — first place to look. If a deploy failed, roll back.
2. **Supabase dashboard** — confirm the database is online. If not, follow Supabase status page.
3. **Vercel function logs** — `/api/ai-analysis` logs Ollama/OpenAI errors. If the AI provider is down, the app should self-heal (fallback to mock) without intervention.
4. **Browser console of an affected user** — RPC errors here usually point to a missing migration or a misconfigured env var.
5. **Audit heartbeat** — `/more` → Admin diagnostics → "Audit events (24h)". A zero or near-zero number when the system should be active is a red flag.

If you cannot restore service in 30 minutes, communicate proactively to the workspace OWNER. There is no built-in status page yet.

---

## 8. Monitoring + observability

Not yet built. For a paid pilot, add:

- **Sentry** (or PostHog) for front-end errors. Wrap `<AppErrorBoundary>` with the SDK.
- **Vercel Function Logs** for `/api/ai-analysis`. Already free.
- **Supabase Logs** for slow queries. Already free in the dashboard.
- **External uptime monitor** (UptimeRobot, Better Uptime) hitting the deployed URL every 60 s.

A dedicated monitoring story is its own day of work — recommended before opening to multiple paying customers.

---

## 9. Performance baselines (as of Phase 12)

After `npm run build`:

| Asset | Size (raw) | Size (gzip) |
| --- | --- | --- |
| `index.js` | ~121 kB | ~28 kB |
| `index.css` | ~107 kB | ~19 kB |
| `react-*.js` | 197 kB | 63 kB |
| `supabase-*.js` | 195 kB | 50 kB |

Total initial payload: ~620 kB raw, ~160 kB gzipped. Fast on broadband, acceptable on 4G.

Initial load fires:
- 1× `get_dashboard`
- 1× `/api/ai-analysis` boot probe
- (lazy) Activity feed when CEO/Founder dashboard mounts (25 rows)
- (lazy) AI insights when CEO/Founder dashboard mounts
- (lazy) Get tasks by view when `/tasks` opened

No periodic polling. No long-polling. Pure pull on user action.

---

## 10. Cost (rough order of magnitude)

For a 20-user, single-workspace customer at typical usage:

| Item | Monthly cost |
| --- | --- |
| Vercel hobby tier | $0 |
| Vercel Pro (recommended for paid pilot) | $20 |
| Supabase Free tier | $0 |
| Supabase Pro (recommended for paid pilot) | $25 |
| OpenAI (`gpt-4o-mini`, ~500 AI notes + ~20 reports / mo) | ~$5 |
| Domain (if custom) | $1 |
| **Total** | **~$50 / mo** |

Self-hosted Ollama avoids the OpenAI cost but adds an ops burden. Pick based on customer constraints.

---

## 11. Common deployment gotchas

1. **Forgot to apply a SQL migration after pulling the latest `main`.** Symptom: front-end shows "function get_X_rpc does not exist". Run the missing migration.
2. **Vercel deployed but Supabase URL wrong.** Symptom: blank login page, console says "Add Supabase keys in .env.local". Re-check env vars in Vercel, redeploy.
3. **`/api/ai-analysis` 404.** Means you're running `vite dev` instead of `vercel dev`. The `/api/*` route only works in Vercel runtime. For local dev with AI testing, use `npx vercel dev`.
4. **Stale `.git/index.lock`.** If commits aren't going through, `rm -f .git/index.lock` from a fresh terminal. (Familiar from the development sprint logs.)
5. **`dist-verify/` directory in repo root.** Build artifact from sandbox testing; safe to delete and add to `.gitignore`.
6. **AI mode pill stuck at "Checking…".** /api/ai-analysis route is unreachable. Check Vercel function logs.

---

## 12. Upgrade path

Future phases (per `MULTI_ORG_IMPLEMENTATION_PLAN.md`):

- Multi-tenant migration (workspace_id everywhere). Requires careful staging deploy.
- Stripe billing integration (`BILLING_AND_LIMITS_PLAN.md`).
- Custom domains + email-sender + SSO.

Each is its own controlled release. Do not attempt them mid-week.

---

## 13. Support contacts

- Application bugs: file an issue in the source repo OR email `support@omnimate.example` (configurable via BRAND_CONFIG).
- Infrastructure (Supabase / Vercel outages): use the providers' own status pages and support channels.
- Security incidents: see `SECURITY_RBAC_AUDIT.md` for the contact and procedure.

---

## 14. Pre-launch checklist (engineer-side)

Before a paid customer touches the app:

- [ ] Supabase upgraded from Free to Pro (point-in-time recovery).
- [ ] Vercel upgraded from Hobby to Pro (better cold-start, more bandwidth).
- [ ] All 25 SQL migrations applied. Verify with `select count(*) from pg_proc where proname like 'get_%'`.
- [ ] Vercel env vars complete. Test by hitting `/api/ai-analysis` with curl (see `AI_PRODUCTION_READINESS.md` §9).
- [ ] Sentry (or PostHog) integrated for error tracking.
- [ ] External uptime monitor configured.
- [ ] CEO + at least one Founder + at least one Intern user created and verified.
- [ ] Backup restoration tested.
- [ ] Security audit items from `SECURITY_RBAC_AUDIT.md` §6 reviewed (revoke anon grants on admin RPCs, body cap on `/api/ai-analysis`, etc.).

When all eight are green, the deployment is paid-pilot-ready.

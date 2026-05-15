# Admin Onboarding Guide — Omni Monitor

For CEOs, founders, and operations leads who set up Omni Monitor for the first time.

This guide takes ~30 minutes end to end and assumes the app is already deployed (see `DEPLOYMENT_AND_ENV_GUIDE.md`). If you only need to understand what the app does day-to-day, see `EMPLOYEE_USER_GUIDE.md`.

---

## 1. Who has access — the role model

Omni Monitor ships with four roles. Pick the right one for each new hire on day one.

- **CEO** — full company access. Sees all tasks, all members, all rankings, all AI insights, the audit log, and the system-health diagnostics. Only the CEO can apply strikes or generate weekly company reports.
- **FOUNDER / BOARD** — department-scoped leadership. Sees their own department's interns, can review submitted work, sees department AI insights, and can manage department templates. Cannot see other departments' confidential data.
- **INTERN** — execution-only. Sees only their own tasks, deadlines, proofs, and notifications. Does not see leadership analytics, AI insights, audit logs, or rankings.

There is no admin-of-admins role yet. Promotion between roles is done in Supabase directly (see §6).

---

## 2. First-day setup — under 30 minutes

### 2.1 Verify your deployment (5 min)

1. Open the deployed URL in a private browser window.
2. Log in with the seeded CEO account (credentials provided during deployment).
3. Top-right of the NavBar: confirm the AI mode pill renders. Green "AI Active" means the AI provider is reachable.
4. Open `/more` → "Show" Admin diagnostics. Confirm the six stat cards populate. This proves the audit chain is wired end to end.

If the pill is red ("AI Unavailable"), see `AI_PRODUCTION_READINESS.md` §9 — that does NOT block onboarding; AI is advisory only.

### 2.2 Add your team (10 min)

Users are created directly in the database during this phase. From the Supabase dashboard SQL editor:

```sql
insert into app_users (name, username, password_hash, role, title) values
  ('Jane Doe', 'jane.doe', crypt('temporary-password-123', gen_salt('bf')), 'FOUNDER', 'Frontend Lead'),
  ('Bob Smith', 'bob.smith', crypt('temporary-password-123', gen_salt('bf')), 'INTERN', 'Frontend Intern');
```

Important:
- `username` must be unique and lowercase with dots/underscores.
- `password_hash` uses bcrypt via `crypt()`. The user changes their password on first login from their profile screen.
- `role` is one of `'CEO'`, `'FOUNDER'`, `'BOARD'`, `'INTERN'`.

### 2.3 Set up departments (5 min)

Departments today are derived from `title` or username. To put a user in the frontend department, their title must contain "frontend" (e.g., "Frontend Lead", "Frontend Intern"). For backend, title contains "backend".

For interns, you can alternatively use the hardcoded mapping in `supabase/round4-task-workflow.sql:user_department`. If you add many new interns and need them assigned to a department, contact engineering — this mapping will be replaced with a proper column in a follow-up phase.

### 2.4 Configure AI (optional, 10 min)

See `AI_PRODUCTION_READINESS.md` §4. The fastest path is:

```
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Set these in your Vercel project settings. Redeploy. AI mode pill should flip from "Mock Mode" to "AI Active" within a minute.

For privacy-sensitive customers who want to keep all inference on-prem, use a hosted Ollama deployment instead. Local LAN Ollama works for dev but is not reachable from Vercel.

### 2.5 Run the first end-to-end smoke test (5 min)

As CEO:
1. `/tasks` → "+ Create task". Assign to one of your interns. Set a due date for tomorrow. Submit.
2. Log out, log in as that intern.
3. The new task should appear in today's view. Click into it, submit a proof (text + screenshot).
4. Log out, log in as CEO again.
5. `/more` → Notifications panel should show "Proof submitted" with an "Open task" button.
6. Click the task; approve or request changes.
7. Audit log entry appears in `/more` → Admin diagnostics → Audit log.

If all six steps pass, the deployment is functioning. Welcome aboard.

---

## 3. Daily routines

### 3.1 What the CEO should do every Monday morning

- Open `/home` — the AI Executive Note summarizes the company-wide state. Pay attention to inactive members and high-risk tasks.
- `/more` → Reports → "Weekly Report" or "Weekly AI Report". Download the JSON; share with leadership.
- `/more` → Admin diagnostics → check for any "stuck" tasks. Anything over 7 days in review is a process failure to chase.
- If overdue trend is rising on `/home`, click "Apply Strikes" to enforce accountability (this is a CEO-only button — strikes auto-applied only to overdue tasks per the strike policy).

### 3.2 What Founders / department heads should do every morning

- Open `/home`. Confirm intern workload is balanced (no one with 5+ overdue).
- Address any submission in "Needs Review" within 24 h.
- Use the AI Executive Note's "Recommended next action" as a starting point.

### 3.3 What interns should do every morning

See `EMPLOYEE_USER_GUIDE.md` §2. Short version: check `/home` → today's tasks → focus mode if needed → submit proof at end of day.

---

## 4. Templates + Recurring (Phase 4 features)

If your team does the same kinds of work repeatedly (weekly social posts, daily standups, monthly reports), set up a template.

1. `/tasks` → click any task → "Create template from this task".
2. Edit the template details. Set visibility:
   - `private` — only you can see it
   - `department` — every member in your dept sees it
   - `company` — everyone sees it (use carefully)
3. To make it recurring: open the template, set the cadence (daily / weekly on specific days / once), assignee, deadline time. Save.
4. The app will auto-generate task instances on the schedule. A cron job `generate_due_tasks_rpc` runs nightly.

Pause a recurring task at any time from the template page.

---

## 5. Reviews + the strike policy

Omni Monitor uses a structured review workflow (Phase 2).

- An intern submits a proof → task moves to `SUBMITTED`.
- A reviewer (CEO or assigning Founder) clicks the task → "Open Review" → task moves to `UNDER_REVIEW`.
- Reviewer chooses: **Approve** (`APPROVED`), **Request Changes** (`CHANGES_REQUESTED`), or **Reject** (`REJECTED`).
- If changes requested, the intern resubmits → task moves to `RESUBMITTED` → back to `SUBMITTED`.

**Strikes** are applied automatically by the CEO's "Apply Strikes" button on `/home`. A strike adds to `app_users.strikes` for the assignee. Three strikes is a soft warning threshold (UI shows danger styling); five is a hard escalation. There is no automated escalation today — escalation is a human decision.

A CEO can manually adjust strikes from `/team` → user profile.

---

## 6. Promoting / demoting users

Today this is a SQL operation in the Supabase dashboard:

```sql
update app_users set role = 'FOUNDER' where username = 'jane.doe';
```

Allowed transitions: any role can be set. The change takes effect on the user's next page load. Their existing session continues to work — but the dashboard will redirect to the role-appropriate view.

---

## 7. The audit log

`/more` → Admin diagnostics → Audit log. CEO-only.

Every important action writes a row:
- `CREATE_TASK`, `UPDATE_TASK`, `DELETE_TASK`
- `SUBMIT_WORK`, `ADD_LOG`, `ADD_TASK_COMMENT`
- `TASK_REVIEW` (with meta.action = OPEN_REVIEW | APPROVE | REQUEST_CHANGES | REJECT)
- `APPLY_STRIKE`, `MANUAL_STRIKE_ADD`, `MANUAL_STRIKE_REMOVE`
- `LOGIN`, `CREATE_NOTIFICATION`, `MARK_NOTIFICATION_READ`
- `UPDATE_AVATAR`, `SUBMIT_IDEA`, `UPDATE_IDEA_STATUS`, `DELETE_IDEA`
- `CREATE_RECURRING_TASK`

Filter by action prefix (e.g., `TASK_` shows everything task-related). Logs are immutable; users cannot edit or delete their own audit rows.

**Known gap:** four actions are not yet logged — template create/edit, template archive, recurring pause/resume, AI report generated. Engineering will close these in a follow-up release.

---

## 8. System health — when to worry

`/more` → Admin diagnostics shows six metrics. What to do when each is red:

- **Failed AI reports (30d) > 0** — check `AI_PRODUCTION_READINESS.md` §9; usually a misconfigured env var or Ollama unreachability.
- **Stuck in review (>7d) > 0** — somebody on the leadership team has unreviewed work piling up. Talk to them.
- **Stuck submitted (>5d) > 0** — same, one step earlier. The reviewer hasn't opened the review.
- **Overdue unfinished > 10** — execution health is sliding. Apply strikes or escalate manually.
- **Paused recurring > 0** — informational only. Some recurring task is paused; usually intentional.
- **Audit events (24h) = 0** — surprising. Either nothing happened (slow day) or the audit chain has stopped writing. Check application logs.

---

## 9. Backups + data retention

Today: Supabase automatic daily snapshots. You don't need to do anything.

Data retention is per-customer: audit logs and tasks are kept forever. There is no GDPR-compliant takeout or delete-my-data flow yet — if you have a regulated industry customer, contact engineering before promising compliance.

---

## 10. Where to get help

- Application bugs / questions → email `support@omnimate.example` (set this in `BRAND_CONFIG`).
- Account questions → your Customer Success contact.
- Incident / outage → see `DEPLOYMENT_AND_ENV_GUIDE.md` §7.

---

## 11. Pre-launch checklist (your team is ready)

Tick before you announce Omni Monitor internally:

- [ ] At least one CEO account, at least one Founder per department, at least 3 interns set up.
- [ ] Departments correctly mapped (titles contain "frontend"/"backend" OR usernames are in the hardcoded list).
- [ ] One end-to-end create-task → submit-proof → review smoke test passed.
- [ ] AI mode pill shows the expected state for your config.
- [ ] Admin diagnostics show non-zero "Audit events (24h)".
- [ ] Every user has changed their temporary password.
- [ ] Templates created for at least one recurring workflow your team owns.
- [ ] At least one Weekly Report generated and downloaded successfully.

When all eight are green, your workspace is live.

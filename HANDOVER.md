# Omnimate Monitor Handover

## Project Overview

Omnimate Monitor is a private operations dashboard for assigning tasks, collecting proof, tracking work, ranking founders/interns, and generating CEO reports. The app uses username/password login backed by Supabase RPC functions. Frontend access is through the Supabase anon key only; table access is blocked with RLS and all app behavior goes through RPC.

## Tech Stack

- React with Vite
- Supabase Postgres
- Supabase RPC functions with `security definer`
- `@supabase/supabase-js`
- `lucide-react` icons
- Vercel static deployment

## File Structure

- `src/main.jsx`: React app, login, dashboard, tasks, proof feed, rankings, reports, CEO strike button.
- `src/styles.css`: App styling.
- `src/supabase.js`: Supabase client setup.
- `supabase/schema.sql`: Full reset/fresh-install schema. Do not run on production unless intentionally resetting.
- `supabase/fix-strikes-score.sql`: Non-destructive strike/score fix for existing databases.
- `supabase/strike-system.sql`: Existing non-destructive strike migration, kept updated.
- `supabase/delete-task-rpc.sql`: Non-destructive task deletion RPC migration.
- `.env.example`: Required frontend environment variables.
- `vercel.json`: Vercel SPA routing/build output config.

## Environment Variables

Local `.env.local` and Vercel Project Settings need:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Never commit `.env.local`. Never expose or use the Supabase service role key in frontend code.

## Supabase RPC List

- `login_user(p_username, p_password)`: validates username/password and creates a session token.
- `logout_user(p_token)`: deletes the session token.
- `get_dashboard(p_token)`: validates the session, applies overdue strikes, and returns visible users, tasks, rankings, and proof feed.
- `create_task_rpc(p_token, p_title, p_details, p_assigned_to, p_priority, p_due_date)`: CEO/Board task assignment with RBAC.
- `update_task_status_rpc(p_token, p_task_id, p_status)`: updates task status with RBAC.
- `delete_task_rpc(p_token, p_task_id)`: CEO/Board deletion for allowed tasks.
- `add_log_rpc(p_token, p_task_id, p_note, p_minutes, p_screenshot_data_url, p_is_submission)`: adds proof/time logs and optionally marks a task as submitted.
- `get_report_rpc(p_token, p_period)`: CEO-only weekly/monthly report payload.
- `score_for_user(p_user)`: calculates score, including strike penalties.
- `apply_strikes()`: applies overdue strikes idempotently.
- `apply_strikes_rpc(p_token)`: CEO-only manual strike sweep used by the dashboard button.

## Roles And RBAC

- `CEO`: sees all active users, all tasks, all rankings, reports, delete controls, and the manual `Apply Strikes Now` button.
- `BOARD`: can see interns, assign/delete intern tasks, and update allowed intern tasks.
- `FOUNDER`: sees own founder ranking and intern ranking, own tasks, and can submit proof/logs.
- `INTERN`: sees own tasks/ranking and can submit proof/logs.

RLS is enabled on tables and there are no broad table policies. The frontend should only use the anon key and RPC functions.

## Adding Users Or Interns

Add users directly in Supabase SQL Editor. Pick one of the allowed roles: `CEO`, `BOARD`, `FOUNDER`, `INTERN`.

```sql
insert into app_users(name, username, password_hash, role, title)
values (
  'New Intern Name',
  'new_intern',
  crypt('temporary-password', gen_salt('bf')),
  'INTERN',
  'Marketing Intern'
);
```

Usernames must match `^[a-z0-9_]{3,40}$`. Have the user change the temporary password after first login by asking an admin to run the reset SQL below.

## Resetting Passwords

Run this in Supabase SQL Editor:

```sql
update app_users
set password_hash = crypt('new-temporary-password', gen_salt('bf'))
where username = 'new_intern';
```

## Strike System

Strikes are applied when `get_dashboard(p_token)` loads and when the CEO clicks `Apply Strikes Now`.

Rules:

- `tasks.due_date < current_date`
- `tasks.status <> 'DONE'`
- `tasks.strike_applied = false`

When all conditions match, the database increments the assigned user's `app_users.strikes` by 1, sets `tasks.strike_applied = true`, and writes an `APPLY_STRIKE` audit log entry. The `strike_applied` flag makes the process idempotent, so refreshing the dashboard does not duplicate strikes.

Scoring uses:

```text
normal_score - (strikes * 25)
```

Scores can be negative. Example: 0 normal points and 1 strike equals `-25`.

For existing databases, run `supabase/fix-strikes-score.sql` once in Supabase SQL Editor. Do not rerun `supabase/schema.sql` on live data.

## Deploying On Vercel

1. Push the repository to GitHub.
2. Import the repo in Vercel.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Project Settings.
4. Keep `.env.local` out of git.
5. Run the needed Supabase migrations before or alongside deployment.
6. Deploy. Vercel will run `npm run build` and serve `dist`.

## Operational Rules

- Never commit `.env.local`.
- Never use the Supabase service role key in frontend code.
- Do not run `supabase/schema.sql` on production unless intentionally resetting all app tables.
- Use non-destructive migrations from `supabase/` for live fixes.
- Keep all frontend database access behind RPC calls.

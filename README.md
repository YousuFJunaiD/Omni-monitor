# Omnimate Monitor

Internal monitoring dashboard for Omnimate team operations.

## Included

- Username and password login
- Supabase RPC-backed dashboard
- Role-based visibility for CEO, Board, Founders, and Interns
- Task assignment, status updates, deletion, deadlines, overdue indicators, and strikes
- Screenshot paste/upload proof feed
- Founder and intern rankings
- Weekly and monthly report downloads

## Local Setup

Copy `.env.example` to `.env.local` and set:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Install and run:

```bash
npm install
npm run dev
```

## Existing Supabase Project

Do not rerun `supabase/schema.sql` against a live database unless you intentionally want to reset it.

For existing projects, apply only the non-destructive migration files you need from `supabase/`, such as:

- `supabase/strike-system.sql`
- `supabase/fix-strikes-score.sql`
- `supabase/founder-intern-management.sql`
- `supabase/idea-board.sql`
- `supabase/delete-task-rpc.sql`

## Build

```bash
npm run build
```

## Deploy On Vercel

1. Push the repository to GitHub.
2. Import the repository in Vercel.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Project Settings.
4. Deploy.

`vercel.json` is configured for Vite output from `dist` and SPA rewrites to `index.html`.

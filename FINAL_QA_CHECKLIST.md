# Final QA Checklist — Omni Monitor

A run-through-and-tick checklist for the human pilot. Companion to `FINAL_QA_REPORT.md` (which is the code-level audit) — this file is the on-screen verification.

**How to use:** open the deployed app in a browser. Have DevTools open (Console + Network tabs). Work through the sections in order. Tick each box as you observe the expected behaviour. Anything that fails goes into a "Issues found" note at the bottom of this file.

**Estimated time:** 45 minutes for a thorough single-pass; 90 minutes if running all three role flows.

---

## 0. Pre-flight

- [ ] All 23 SQL migrations applied to the target Supabase project (schema + 22 rounds).
- [ ] Both `round22-security-audit-hardening.sql` and `round23-audit-log-completeness.sql` applied if you want the new audit/security improvements live.
- [ ] At least one CEO account, one Founder per department, and 2+ interns exist.
- [ ] Vercel environment variables set per `DEPLOYMENT_AND_ENV_GUIDE.md`.
- [ ] Browser cache cleared (or use an incognito window).
- [ ] DevTools open — Console tab AND Network tab.

---

## 1. Login + boot

- [ ] Open the deployed URL in a fresh tab. Login screen renders.
- [ ] Logo mark, company name, tagline, login description all reflect `BRAND_CONFIG`.
- [ ] Log in as CEO. Lands on `/home`.
- [ ] NavBar shows: logo, navigation tabs, AI mode pill, user info, logout button.
- [ ] AI mode pill state matches your config:
  - Green "AI Active" — Ollama/OpenAI reachable.
  - Amber "Fallback Mode" — Ollama configured but unreachable (LAN IP from Vercel).
  - Neutral "Mock Mode" — AI disabled (no env vars).
  - Red "AI Unavailable" — `/api/ai-analysis` 404 or 5xx.
  - Pulsing "AI Checking…" — initial state, should resolve within 20 s.
- [ ] Network tab shows exactly ONE call to `get_dashboard` and ONE to `/api/ai-analysis` on boot.

---

## 2. CEO flow (15 min)

Log in as a CEO user.

### 2.1 `/home` dashboard

- [ ] Executive Note card renders at top with source badge (AI / Rule-based / Fallback).
- [ ] Note body references real queue counts — spot-check against the stats row below it.
- [ ] Six stat cards: Overdue, Needs Review, Blocked, Open Ideas, Top Score, Total Strikes.
- [ ] Department health row shows Frontend + Backend cards with member counts + per-dept queues.
- [ ] AI critical insights panel shows up to 5 high-severity items (or "No critical insights").
- [ ] Three execution queues: Overdue, Needs Review, Blocked.
- [ ] Bottlenecks + High-risk tasks two-column row.
- [ ] Top founders + Top interns ranking cards.
- [ ] Overdue trend 7-day mini histogram.
- [ ] Inactive members card.
- [ ] Review queue summary + Finance placeholder (text from `BRAND_CONFIG.financePlaceholderText`).
- [ ] Company Activity feed (up to 25 rows initially; "Load more" if available).
- [ ] Proof Feed showing recent proofs.

### 2.2 CEO actions

- [ ] Click "Apply Strikes" — toast: "Applied N strike(s)" or "No overdue strikes to apply".
- [ ] Click "Generate Weekly Report" — toast: "Weekly report generated · N insight(s)".
- [ ] Open one task. Mark in progress → submitted (you may need to set up a task first).
- [ ] Click "Apply Strikes" again — should reflect the new state.

### 2.3 `/tasks`

- [ ] View switcher: Today / Overdue / Under Review / History. Each loads independently.
- [ ] Filters: status, assignee, due date. Each narrows the list.
- [ ] Kanban + List toggle.
- [ ] Templates tab loads templates list.
- [ ] Click "Create task" — modal opens. Create a test task; it appears in the list.
- [ ] Click a task → drawer opens with details, comments, timeline.

### 2.4 `/team`

- [ ] Department rankings row.
- [ ] Founding member rankings.
- [ ] Intern rankings.
- [ ] Click into a member's profile.

### 2.5 `/more`

- [ ] Reports panel (CEO only): 4 buttons. Click "Weekly Report" — JSON loads, "Download JSON" works.
- [ ] **Admin diagnostics panel (CEO only):** click "Show" → loads.
- [ ] 6 stat cards populate with counts.
- [ ] Drill-down lists for stuck tasks render when count > 0.
- [ ] Audit log table loads (paginated to 100).
- [ ] Filter input — type `TASK_REVIEW`, click Refresh — list narrows.
- [ ] Notifications panel: category pills (Review, Urgent, AI, Proof, Task, Deadline, Changes Requested, Strike, System).
- [ ] Click a notification with an "Open task" button — switches to `/tasks` and opens the task drawer.

### 2.6 Network panel for CEO

Expected RPCs fired across `/home` + `/more`:
- [ ] `get_dashboard`
- [ ] `/api/ai-analysis` (boot probe + one when CeoHomeView mounts if AI active)
- [ ] `get_ai_insights_rpc`
- [ ] `get_activity_feed_rpc` (limit=25)
- [ ] `get_notifications` (on MoreTab mount)
- [ ] `get_audit_logs_rpc` (only when Admin diagnostics "Show" clicked)
- [ ] `get_system_health_rpc` (same)

No duplicates within seconds. No 4xx/5xx.

### 2.7 Console for CEO

- [ ] Zero red errors after walking through `/home`, `/tasks`, `/team`, `/more`, `/ideas`, `/profile`.
- [ ] Warnings are acceptable (React HMR, lazy-load logging).

---

## 3. Founder / Board flow (10 min)

Log in as a Founder user (one whose title contains "frontend" or "backend", OR whose username is in the hardcoded mapping).

### 3.1 `/home` scoping

- [ ] Executive Note source label: "AI" or "Rule-based" (not blocked).
- [ ] Note text mentions the founder's department name (Frontend or Backend).
- [ ] Stats row: "Dept Overdue", "Dept Review", "Dept Blocked", "Interns", "Dept Top Score", "Dept Strikes".
- [ ] Numbers reflect ONLY the founder's department (not company-wide).
- [ ] Intern management panel lists ONLY this founder's department's interns.
- [ ] Workload bars show only this founder's interns.
- [ ] Performance trends ranking entries are dept-scoped.
- [ ] AI insights panel shows dept-scoped insights.
- [ ] Activity feed title: "Department activity".

### 3.2 RBAC checks for Founder

- [ ] **NO "Apply Strikes" button** anywhere on `/home`.
- [ ] **NO "Generate Weekly Report" button** anywhere on `/home`.
- [ ] `/more` — Reports panel does NOT render (CEO-only).
- [ ] `/more` — Admin diagnostics panel does NOT render (CEO-only).
- [ ] Try forcing the admin RPC via Console:
  ```js
  await (await fetch(window.location.origin.replace(/:\d+$/,'') + '/path/to/supabase/rest/v1/rpc/get_audit_logs_rpc', {
    method:'POST',
    headers:{
      'apikey':'<your anon key>',
      'Authorization':'Bearer <your anon key>',
      'Content-Type':'application/json'
    },
    body: JSON.stringify({p_token: localStorage.getItem('omnimate_session_token')})
  })).json()
  ```
  - [ ] Returns `{ok:false, error:"Not allowed"}` — confirms SQL-layer RBAC.
- [ ] Open DOM Elements panel; search for an out-of-department intern's name (e.g., backend founder searches a frontend intern). Should not appear on `/home`. (Note: it may appear in `/team` — that's expected and a separate Phase-13 hardening item.)

### 3.3 Network for Founder

- [ ] `get_dashboard`, `get_activity_feed_rpc`, `get_ai_insights_rpc`, `get_notifications` all fire.
- [ ] `get_audit_logs_rpc`, `get_system_health_rpc` do NOT fire automatically.

### 3.4 Review workflow

Have an intern submit a proof first (or test below as Intern then come back).
- [ ] PROOF_SUBMITTED notification appears in `/more`.
- [ ] "Open task" deep-link opens the task detail drawer.
- [ ] Click "Open Review", then Approve / Request Changes / Reject — each works.
- [ ] The task's status pill in the drawer updates.
- [ ] Activity timeline shows the new event.
- [ ] If round23 is applied: audit log shows the matching TASK_REVIEW row.

---

## 4. Intern flow (10 min)

Log in as an Intern user.

### 4.1 `/home` scope

- [ ] Executive Note source label: "Rule-based" or "Fallback" — NEVER "AI" (interns never trigger AI calls).
- [ ] Header eyebrow: "Today".
- [ ] Focus mode toggle button visible.
- [ ] Stats row: Today / Overdue / In Review / Changes / My Score / My Rank.
- [ ] Numbers are personal — only tasks where the intern is the assignee.
- [ ] Today's tasks list shows ONLY the intern's tasks.
- [ ] Coming up (7 days) section.
- [ ] Pending reviews + Changes requested two-column.
- [ ] Recent proofs section (only the intern's submissions).

### 4.2 Focus mode

- [ ] Click "Focus mode". Everything after Today's tasks hides.
- [ ] Stats row dims slightly.
- [ ] Click "Exit focus mode" — sections return.

### 4.3 Intern RBAC (the most important checks)

- [ ] Network panel: `get_ai_insights_rpc` does NOT fire on `/home`.
- [ ] Network panel: `get_activity_feed_rpc` does NOT fire on `/home`.
- [ ] Open `/tasks` — Network: `get_task_templates_rpc` does NOT fire (Phase 7 intern skip).
- [ ] `/more` — Admin diagnostics panel does NOT render.
- [ ] `/more` — Reports panel does NOT render.
- [ ] Try the same negative test as Founder (force-call `get_audit_logs_rpc` from Console). Expected: `{ok:false, error:"Not allowed"}`.

### 4.4 Submit a proof

- [ ] Open any of the intern's TODO tasks.
- [ ] Click "Submit Proof". Add a note. Optionally upload a screenshot.
- [ ] Check "This is my submission". Submit.
- [ ] Task status flips to SUBMITTED.
- [ ] Activity timeline shows "Proof submitted".
- [ ] Switch to the assigning founder/CEO — they should see the notification.

### 4.5 Handle "Changes requested"

(After a reviewer requests changes on one of the intern's submissions.)
- [ ] Notification appears with "Changes Requested" category badge.
- [ ] "Open task" deep-link → task drawer with reviewer's comment.
- [ ] Submit another proof. Status moves RESUBMITTED → back to SUBMITTED.

---

## 5. Mobile pass (5 min)

Use real mobile device OR Chrome DevTools device emulation (iPhone 13 / Pixel 7 / iPad).

### 5.1 At 375 px (iPhone-class)

- [ ] Login page renders correctly. Buttons full-width or comfortable size.
- [ ] NavBar collapses; mobile-app-title row visible. AI mode pill shows dot only (no label text).
- [ ] `/home`: page header, stats row, panels all tighten. No horizontal scroll.
- [ ] Executive Note body wraps cleanly.
- [ ] Attention queues stack vertically (single column).
- [ ] Tap a task → drawer opens. Drawer is readable on narrow screen.
- [ ] Notifications row collapses (action buttons reflow below body if narrow).
- [ ] Bottom tab navigation works (or scroll-tabs, depending on device).

### 5.2 At 320 px (very small)

- [ ] No content gets clipped.
- [ ] No buttons overflow their cards.
- [ ] Page is still usable for end-of-day proof submission by an intern.

### 5.3 At 768 px (tablet)

- [ ] Two-column grids (Department health, etc.) still show side-by-side OR collapse cleanly at the breakpoint.
- [ ] NavBar shows full text.

---

## 6. AI mode probe (3 min)

For each AI provider configuration you intend to support:

### 6.1 With `OPENAI_API_KEY` set

- [ ] AI mode pill: green "AI Active".
- [ ] CEO Executive Note source badge: "AI" (green).
- [ ] Curl probe:
  ```
  curl -sS -X POST https://your-omni.example.com/api/ai-analysis \
    -H 'Content-Type: application/json' \
    -d '{"context": {"probe": true, "insights": []}}' | jq
  ```
- [ ] Returns `{ ok: true, provider: "openai", model: "...", summary: "..." }`.

### 6.2 With Ollama (LAN, unreachable from Vercel)

- [ ] After ~20 s timeout, pill flips to amber "Fallback Mode".
- [ ] Curl returns `{ok: true, provider: "mock", fallback: true, fallback_from: "Ollama", fallback_reason: "timeout"}`.
- [ ] CEO Executive Note source badge: "Fallback" (grey).

### 6.3 With no AI env vars

- [ ] Pill: neutral "Mock Mode".
- [ ] Curl: `{ok: true, provider: "mock", rule_based: true}`.

### 6.4 With `/api/ai-analysis` not deployed (`vite dev` instead of `vercel dev`)

- [ ] Pill: red "AI Unavailable".
- [ ] App still works; Executive Note uses rule-based source.

---

## 7. Templates + recurring (3 min)

- [ ] CEO: `/tasks` → Templates tab. List loads.
- [ ] Create a template: title, description, priority, default department, default proof requirement, checklist. Visibility = `private`.
- [ ] Use it: "Use template" → opens Create Task modal with fields prefilled.
- [ ] Edit the template (CEO/Founder of template can). Verify visibility=`department` makes it visible to dept teammates.
- [ ] Archive a template. Verify it doesn't appear by default; toggle "Show archived" to see it.
- [ ] If round23 applied: audit log entry "ARCHIVE_TEMPLATE" appears.
- [ ] Create a recurring task from the template. Verify task instances generate (may require waiting for cron OR manually calling `generate_due_tasks_rpc` from CEO).
- [ ] Pause the recurring task. If round23 applied: audit log entry "PAUSE_RECURRING".
- [ ] Resume. Audit log entry "RESUME_RECURRING".

---

## 8. Reports (2 min)

- [ ] CEO `/more` → "Weekly Report". Loads. Shows top founder/intern, downloadable JSON.
- [ ] "Monthly Report" — same.
- [ ] "Weekly AI Report" — generates. If AI is active, summary text appears; if not, "Metrics report saved. AI is disabled or unavailable.".
- [ ] Downloaded JSON contains expected fields.

---

## 9. End-of-pass summary

After running everything above:

- [ ] Zero red console errors throughout.
- [ ] No unexpected RPC duplicates in Network tab.
- [ ] All three roles (CEO / Founder / Intern) behave per their RBAC.
- [ ] Admin diagnostics shows non-zero "Audit events (24h)" — proves the audit chain is alive.
- [ ] AI mode pill state is correct for the deployed configuration.
- [ ] Mobile is usable for all three roles.

### Issues found (fill in)

| # | Where | What you saw | Expected | Severity (low/med/high) |
| --- | --- | --- | --- | --- |
|   |   |   |   |   |
|   |   |   |   |   |

---

## 10. Sign-off

When every checkbox above is ticked and the issues table is empty (or all issues are low-severity with mitigations recorded):

```
QA pass complete: ____________________________  (signature)
Date:               ____________________________
Build commit:       ____________________________   (from git log -1)
Migrations applied: ____________________________   (e.g., "schema.sql + round 1–23")
AI provider:        ____________________________   (openai / hosted-ollama / mock)
Deploy target:      ____________________________   (preview / staging / production)
```

That signed page is what makes the deployment paid-pilot-ready.

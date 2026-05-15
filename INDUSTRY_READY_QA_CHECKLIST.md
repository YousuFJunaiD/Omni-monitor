# Industry-Ready QA Checklist — Omni Monitor

A focused tick-through for a **client deployment** (i.e. you've configured a new client with `VITE_CLIENT_*` env vars and want to verify nothing leaked the Omnimate defaults). Use this AFTER `FINAL_QA_CHECKLIST.md` has been completed for the underlying app.

**Time:** ~30 minutes.

**Pre-req:** the client deployment is live at a URL you can browse, all client `VITE_CLIENT_*` env vars are set, and `CLIENT_DEPLOYMENT_TEMPLATE.md` § 4 (first sign-in) passed.

---

## 1. Brand replacement — visible UI strings

Open the deployed URL in a fresh private browser window. WITHOUT logging in:

- [ ] Login screen logo mark shows the client's `VITE_CLIENT_LOGO_MARK` (NOT "OM").
- [ ] Login screen heading shows the client's `VITE_CLIENT_COMPANY_NAME` (NOT "Omnimate").
- [ ] Login screen subheading shows the client's `VITE_CLIENT_APP_HEADING` (NOT "Execution OS" unless that's deliberate).
- [ ] Login description matches `VITE_CLIENT_LOGIN_DESCRIPTION` (or the default if left blank).

Log in as the client's CEO:

- [ ] NavBar logo mark = `VITE_CLIENT_LOGO_MARK`.
- [ ] NavBar product name = `VITE_CLIENT_PRODUCT_NAME` (NOT "Omnimate Monitor").
- [ ] NavBar subtitle = `VITE_CLIENT_TAGLINE`.
- [ ] NavBar workspace pill shows the user's title OR `VITE_CLIENT_WORKSPACE_LABEL`.
- [ ] AI mode pill renders. Confirm green/amber/grey/red matches the AI strategy.

Do a full-DOM search (Cmd+F or DevTools Elements → search) for the substring **`Omnimate`**:

- [ ] Zero matches anywhere on `/home`.
- [ ] Zero matches on `/tasks`.
- [ ] Zero matches on `/more`.
- [ ] Zero matches on `/team`.
- [ ] Zero matches on `/profile`.

If any "Omnimate" shows up, the corresponding env var is missing or was left blank. Set it and redeploy.

(Note: the `omnimate_session_token` localStorage key and similar internal identifiers WILL still contain "omnimate" — that's correct. The check is for visible UI text.)

---

## 2. CEO admin dashboard

Log in as the client's CEO. Open `/home`:

- [ ] Executive Note card renders with `VITE_CLIENT_AI_ASSISTANT_NAME` as its title (NOT "AI Executive" unless that's the client's choice).
- [ ] Operational snapshot stat row has reasonable counts (likely zeros for a fresh deployment — that's expected).
- [ ] Department health cards show the client's department labels (NOT "Frontend"/"Backend" unless that's the client's choice).
- [ ] AI critical insights panel renders (empty is fine for a new deployment).
- [ ] Three execution queues render. Empty state messaging is non-Omnimate.
- [ ] Apply Strikes button is visible (CEO-only).
- [ ] Generate Weekly Report button is visible (CEO-only).
- [ ] Finance placeholder card text matches `VITE_CLIENT_FINANCE_PLACEHOLDER`.
- [ ] Company Activity feed empty state is reasonable.
- [ ] Proof Feed empty state is reasonable.

Quick CEO action smoke test:

- [ ] Click "Apply Strikes" — toast appears. No errors.
- [ ] Click "Generate Weekly Report" — toast confirms success (and AI mode pill consistency).

Open `/more`:

- [ ] Reports panel renders (CEO-only).
- [ ] All four report buttons fit within the panel — no overflow.
- [ ] "Show" admin diagnostics — six stat cards populate without errors.
- [ ] Audit log table loads. Action filter input renders.
- [ ] Notifications panel renders with category filter pills (only categories with ≥1 unread shown; "All" always shown).

---

## 3. Manager / Founder dashboard

Log in as a Founder user (one whose title or username maps to a department).

- [ ] Header eyebrow shows the department label (e.g., "Frontend team" → client's relabel).
- [ ] AI Executive Note source label is "AI" or "Rule-based" (NEVER missing).
- [ ] Stats row: dept-scoped counts ("Dept Overdue", "Dept Review", etc.) — confirm using the client's department renames.
- [ ] Intern management panel: lists only the Founder's department's reports (not other departments).
- [ ] Performance trends list scoped to dept.
- [ ] AI insights panel: dept-scoped only.
- [ ] No "Apply Strikes" button anywhere.
- [ ] No "Generate Weekly Report" button anywhere.
- [ ] `/more` — Reports and Admin diagnostics panels NOT visible.

---

## 4. Employee / intern dashboard

Log in as an Intern user.

- [ ] Header eyebrow says "Today" (or the localised equivalent).
- [ ] AI Executive Note source label is "Rule-based" or "Fallback" — never "AI" (interns must never trigger an AI call).
- [ ] Stats row: personal counts only ("Today", "Overdue", "In Review", "Changes", "My Score", "My Rank").
- [ ] Today's tasks list shows only this intern's tasks.
- [ ] Focus mode toggle button visible. Click — UI collapses to today's tasks only.
- [ ] Exit focus mode — full layout returns.
- [ ] Coming up (7 days) section.
- [ ] Pending reviews + Changes requested two-column.
- [ ] Recent proofs section (only intern's submissions).
- [ ] `/more` — Reports panel NOT visible. Admin diagnostics NOT visible.

DevTools Network panel for the intern session:

- [ ] On `/home` open: `get_ai_insights_rpc` does NOT fire.
- [ ] On `/home` open: `get_activity_feed_rpc` does NOT fire.
- [ ] On `/tasks` open: `get_task_templates_rpc` does NOT fire.

---

## 5. Task workflow end-to-end

Log in as Founder. Create a task assigned to one of their interns.

- [ ] Task appears in the intern's `/home` "Today's tasks" and `/tasks`.

Log in as the intern. Open the task.

- [ ] Status updates work (TODO → IN_PROGRESS).
- [ ] Click "Submit Proof". Add note + optional screenshot.
- [ ] Check "This is my submission". Submit.
- [ ] Task moves to SUBMITTED state.
- [ ] Activity timeline shows "Proof submitted".

Log in as Founder.

- [ ] `/more` Notifications panel: "Proof submitted" notification visible with the correct category badge.
- [ ] Click "Open task" — drawer opens with the right task pre-selected.
- [ ] Click "Open Review" — status → UNDER_REVIEW.
- [ ] Choose Approve. Status → APPROVED.
- [ ] Audit log shows the TASK_REVIEW row.

---

## 6. Templates + recurring (if relevant to the client)

Log in as CEO. `/tasks` → Templates tab.

- [ ] Templates list loads (empty for a fresh deployment — fine).
- [ ] Create a template. Visibility = `department`. Save.
- [ ] Use the template to create a new task — fields prefill correctly.
- [ ] Archive the template. If round23 applied: audit log shows `ARCHIVE_TEMPLATE`.
- [ ] Create a recurring task. Pause it. If round23 applied: audit log shows `PAUSE_RECURRING`.
- [ ] Resume it. Audit log shows `RESUME_RECURRING`.

---

## 7. AI notes + fallback

- [ ] Executive Note source label matches the AI mode pill state.
- [ ] If AI is in mock mode: source label is "Rule-based".
- [ ] If AI is active: source label is "AI" (green).
- [ ] If AI provider returns error: source label is "Fallback" (after timeout, ~20 s).
- [ ] Click "Generate Weekly Report" as CEO — confirm a toast with a real insight count. If AI active, summary text appears.

Quick curl probe:

```bash
curl -sS -X POST <client-deployment-url>/api/ai-analysis \
  -H 'Content-Type: application/json' \
  -d '{"context": {"probe": true, "insights": []}}' | jq
```

- [ ] Response has `ok: true`.
- [ ] `provider` field matches your AI configuration (ollama / openai / mock).
- [ ] `provider_mode` field matches.

---

## 8. Notifications

- [ ] As CEO, click a notification with `link_kind='task'` — `/tasks` opens, task drawer with correct task.
- [ ] Category pills appear above the list. Only categories with ≥1 unread visible (plus "All").
- [ ] Click "Read" on a grouped notification with count > 1 — all unread in the group flip to read.
- [ ] "Mark all read" clears the unread badge.

---

## 9. Admin diagnostics

- [ ] As CEO, `/more` → "Show" admin diagnostics.
- [ ] Six stat cards populate.
- [ ] "Audit events (24h)" is non-zero (proves audit chain is alive).
- [ ] Audit log filter input: type a known action prefix (e.g., `TASK_REVIEW`). List narrows.
- [ ] Click refresh — list reloads.

As a non-CEO user (Founder or Intern), attempt to access the admin RPC directly:

```js
// Run in DevTools console while logged in as non-CEO
await (await fetch('<supabase-rest-url>/rpc/get_audit_logs_rpc', {
  method:'POST',
  headers:{
    'apikey':'<anon key>',
    'Authorization':'Bearer <anon key>',
    'Content-Type':'application/json'
  },
  body: JSON.stringify({p_token: localStorage.getItem('omnimate_session_token')})
})).json()
```

- [ ] Returns `{ok:false, error:"Not allowed"}` — confirms server-side RBAC.

If `round22-security-audit-hardening.sql` is applied, an UNauthenticated call (no token) should hit a Postgres permission-denied response BEFORE the function body runs.

---

## 10. RBAC / security

A focused negative-test pass. Pick one user per role.

For each role, walk through `/home`, `/tasks`, `/team`, `/more`, `/ideas`, `/profile`:

| Check | CEO | Founder | Intern |
| --- | --- | --- | --- |
| Sees full company tasks | ✓ | dept only | own only |
| Sees other-dept member names anywhere | ✓ | should NOT | should NOT |
| Apply Strikes button visible | ✓ | absent | absent |
| Generate Weekly Report visible | ✓ | absent | absent |
| /more Reports panel | ✓ | absent | absent |
| /more Admin diagnostics | ✓ | absent | absent |
| AI insights in dashboard | ✓ | dept-scoped | absent |
| Audit log accessible | ✓ | RPC denies | RPC denies |

Mark any violation as a blocker.

---

## 11. Mobile responsiveness

Use a real device OR Chrome device emulation at 320 / 375 / 414 / 768 px.

At each size:

- [ ] Login page renders correctly. Buttons full-width or comfortable size.
- [ ] NavBar collapses; mobile-app-title row visible.
- [ ] AI mode pill shows dot only on smallest widths.
- [ ] `/home`: no horizontal scroll; panels stack cleanly; stats rows wrap.
- [ ] Executive Note body wraps; source label stays visible.
- [ ] Attention queues stack vertically.
- [ ] Tap a task → drawer opens and is readable.
- [ ] Notifications row collapses (action buttons reflow below body if narrow).
- [ ] /more → admin diagnostics still readable.

---

## 12. Deployment verification

- [ ] All 27 SQL migrations applied to the client's Supabase.
- [ ] Vercel build successful with no warnings.
- [ ] All required env vars present in Vercel.
- [ ] AI mode pill state matches the env-driven AI strategy.
- [ ] Custom domain (if configured) resolves.
- [ ] Supabase Pro tier enabled (for point-in-time recovery).
- [ ] Sentry / error tracking integrated (optional but recommended).
- [ ] Backup tested at least once.

---

## 13. Sign-off

When every box above is ticked, the client deployment is **client-pilot-ready**:

```
Client name:        ____________________________
Deployment URL:     ____________________________
QA pass complete:   ____________________________  (signature)
Date:               ____________________________
Commit:             ____________________________   (git rev-parse HEAD)
Migrations applied: ____________________________   (e.g. "schema + 23 rounds")
AI provider:        ____________________________   (openai / ollama / mock)
Notes / waivers:    ____________________________
```

Hand the signed page to the client account manager.

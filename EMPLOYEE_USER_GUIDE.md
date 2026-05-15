# Employee User Guide — Omni Monitor

Welcome. This guide is for everyone who uses Omni Monitor for daily work — interns, department leads, and founders. CEOs should also read `ADMIN_ONBOARDING_GUIDE.md`.

Goal: by the end of this 10-minute read you'll know how to log in, complete a task, submit a proof, handle review feedback, use templates, and understand what the AI Executive Note is telling you.

---

## 1. Your first login

1. Go to your company's Omni Monitor URL.
2. Enter your username (`first.last` format, lowercase) and the temporary password you received.
3. Land on `/home`. This is your dashboard. The content here changes based on your role.

If you forgot your password, ask your CEO or admin to reset it. There is no self-serve password reset yet.

---

## 2. Your daily routine (5 steps)

This is the workflow Omni Monitor is designed around. Following it makes you visible to your team and keeps the system useful.

### 2.1 Morning: check today's tasks (1 minute)

Open `/home`. The "Today's tasks" section shows everything assigned to you and due today or coming up. Tasks have:

- **Title** — what to do.
- **Priority badge** — LOW / MEDIUM / HIGH / URGENT.
- **Status badge** — TODO / IN_PROGRESS / SUBMITTED / etc.
- **Due date** — when it should be done.

Pick the highest-priority TODO or IN_PROGRESS task. Click it — the detail drawer opens.

### 2.2 Start work and update status

Inside the task drawer:

- Click "Mark in progress" when you start. This signals to your reviewer that you're moving.
- Add comments throughout the day if you have questions or context to share.
- If you get stuck and need a teammate, change the status to BLOCKED and explain in a comment what's blocking you.

### 2.3 End of day: submit a proof

This is the most important habit. A "proof" is evidence that you did the work. Without one, the task can't be reviewed and the reviewer has no idea you finished.

Inside the task drawer:

1. Click "Submit Proof".
2. Add a short text note describing what you completed.
3. Optionally attach a screenshot. (Drag-and-drop or click to upload.)
4. Check "This is my submission" — this moves the task to SUBMITTED status and notifies the reviewer.
5. Click Submit.

You'll get a notification in your bell when the reviewer responds.

### 2.4 Handle review feedback

After your reviewer opens your submission, three things can happen:

- **Approved** — task moves to APPROVED. You're done. Celebrate.
- **Changes requested** — task moves to CHANGES_REQUESTED with a comment from your reviewer. Read the comment, make the fix, and resubmit (same proof flow). Task moves to RESUBMITTED, then back to SUBMITTED.
- **Rejected** — task moves to REJECTED. Talk to your reviewer about why and what comes next.

You'll see all of this in real time on your `/home` "Pending reviews" and "Changes requested" panels.

### 2.5 Use focus mode (optional but recommended)

Top right of your `/home` page, there's a "Focus mode" button. Click it. The dashboard collapses to just "Today's tasks" — no deadlines view, no notifications panel, no clutter. Use this when you have a meeting-light, deep-work day.

Click "Exit focus mode" to expand again.

---

## 3. Notifications — what you see and what to do

Bell icon (or "Notifications" panel under `/more`) shows everything addressed to you:

- **Task assigned** — someone gave you new work. Open it.
- **Proof submitted** (if you're a reviewer) — a teammate submitted. Open and review within 24 h.
- **Changes requested** — your work needs changes. Open and address.
- **Approved / Rejected** — your work was reviewed. Click in to read any comment.
- **Strike applied** — your overdue work got a strike. See §6.
- **Task comment** — someone left a comment on your task.

Categories (Phase 8) help you filter. Click any pill (Review, Urgent, Task, Strike, etc.) to filter the list.

**Action buttons** on a notification open the relevant task directly — saves you a click.

Tip: "Mark all read" at the top clears your unread badge.

---

## 4. Templates — saving time on repeat work

If you find yourself creating the same task over and over (weekly social post, daily standup notes, monthly report), ask your manager to create a template, OR if you're a Founder/CEO, create one yourself.

To create a task from a template:

1. `/tasks` → "Templates" tab.
2. Find the template, click "Use template".
3. The new task is pre-filled with title, description, priority, and checklist.
4. Set the deadline; submit.

Department-visibility templates (`department` scope) are shared across your team. `Private` templates are yours alone. `Company` templates are visible to everyone.

---

## 5. AI Executive Note — what it is and what it isn't

At the top of `/home`, you'll see a card titled with your AI Assistant name (configured per-company). It contains a short paragraph summarizing your current state.

**The note is advisory.** It does not auto-strike you, auto-escalate you, or share your work with anyone you don't know. The AI is the same AI provider configured for your company (OpenAI or your company's self-hosted Ollama). If the AI is unavailable, the note falls back to a rule-based summary computed locally from your task counts — never blank, always actionable.

Look for the source badge on the card:

- **AI** (green) — generated by the AI provider.
- **Rule-based** (grey) — generated locally without an AI call. This is fine; the content is still accurate.
- **Fallback** (grey) — AI was unreachable; rule-based note shown instead.

What it tells you:

- **Interns**: today's priority + the single most-important task to focus on next.
- **Founders**: department workload, pending reviews, recommended next action.
- **CEOs**: company execution health and top priority.

The note refreshes when the dashboard data refreshes. It's a starting point, not the truth — your own judgment matters more.

---

## 6. Strikes — what they mean

A strike is a small mark against an overdue task that wasn't completed in time. The CEO triggers strike application; the system never strikes you spontaneously.

- **1–2 strikes**: a heads-up. Visible to leadership but not acted on.
- **3 strikes**: warning level. UI shows danger styling on your profile. Have a conversation with your manager.
- **5+ strikes**: hard escalation. Performance review territory.

You can see your strike count on `/team` → your profile. If a strike was applied unfairly, talk to your manager — strikes can be removed manually.

---

## 7. What you can't do (by design)

To keep the workspace clean, certain things are scoped by role:

- **Interns** cannot: create tasks, assign tasks to others, view company-wide rankings, view audit logs or system health, see other interns' AI insights, generate reports.
- **Founders/Board** cannot: see departments other than their own (with rare exceptions for cross-department tasks), apply strikes (CEO only), generate weekly company reports (CEO only), view the audit log or system health.
- **CEO** has everything.

If you need access to something and don't have it, talk to your CEO. Don't try to access it through DevTools — the server enforces RBAC and will return "Not allowed."

---

## 8. Mobile

Everything works on a phone. The dashboard collapses to a single column. The AI mode pill collapses to a dot. The NavBar becomes a top bar with the current page label.

Focus mode is especially useful on mobile — fewer distractions, just your tasks.

---

## 9. Where to get help

- App questions / bugs → ask your CEO or send a Slack message to your team's Omni Monitor channel.
- Forgot password / locked out → ask your CEO to reset it in the Supabase dashboard.
- Strike applied that you disagree with → talk to your manager first; CEO can adjust manually.
- AI giving weird summaries → it's advisory only; the rule-based note is the source of truth. Flag it to your CEO.

---

## 10. Quick reference

```
/home      — dashboard for your role
/tasks     — all visible tasks, filterable + Kanban
/team      — rankings + member profiles
/ideas     — submit and track ideas
/more      — notifications, reports (CEO/Founder), admin (CEO)
/profile   — your settings, password, avatar
```

That's the entire app. The rest you learn by using it.

Good luck.

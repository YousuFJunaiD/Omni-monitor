# Industry Deployment Playbook — Omni Monitor

How to sell and deploy Omni Monitor as an internal AI management system across different verticals. For each industry below: a recommended branding configuration, a department/role mapping, an AI assistant naming convention, and the customisations to bring up during the sales conversation.

**Current product mode:** single-client deployable. One Vercel + Supabase per customer. No multi-tenant SaaS yet.

**Universal capability set, regardless of industry:**

- Role-based execution dashboards (CEO / Manager / Team Member).
- Task creation + assignment with proof submissions and structured review workflow.
- Templates + recurring tasks for repeat work.
- AI Executive Notes summarising operational state per role.
- Notification centre with categories, grouping, and deep links.
- Audit trail + admin diagnostics (CEO only).
- White-label branding via `VITE_CLIENT_*` env vars.

Industries below are example positionings — the underlying engine is the same.

---

## 1. Schools / Education administration

**Pitch:** an internal hub for school admin to track principal, vice-principal, department head, and teacher assignments. Every assignment has a deadline, a proof (uploaded document), and a structured review by senior admin. AI summarises monthly operational health for the principal.

| Setting | Recommended value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | School Ops Hub |
| `VITE_CLIENT_TAGLINE` | Administration & operations workspace |
| `VITE_CLIENT_INDUSTRY_LABEL` | School Administration |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Operations Assistant |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Principal |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Vice Principal |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Department Head |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Teacher |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Academics |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Operations |

**Department add-ons (engineering task):** "Pastoral", "Admissions", "Finance". Adds rows in `user_department()` via a small migration.

**Workflows that resonate:**
- Daily attendance recurring task per teacher.
- Lesson-plan submissions reviewed weekly by HOD.
- Parent-meeting follow-ups with proof = meeting notes.

**AI notes show:**
- Department health by subject area.
- Teachers with no recent submissions ("inactive").
- Stalled approvals on lesson plans.

**Reports useful:**
- Weekly: per-department teacher submission rates.
- Monthly: term-level execution analysis.

**Sales angle:** "Replace the WhatsApp groups + Google Sheets your admin team uses with a structured workspace. Every assignment has accountability."

---

## 2. Marketing / creative agencies

**Pitch:** project execution for client work. Account managers assign tasks to creatives and developers; deliverables have proofs (screenshots, drafts, links); senior creative directors review. AI gives the agency principal a daily pulse on every active client engagement.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Agency Name> Hub |
| `VITE_CLIENT_TAGLINE` | Studio operations & client execution |
| `VITE_CLIENT_INDUSTRY_LABEL` | Agency Workspace |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Creative Director Assist |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Founder |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Account Director |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior Lead |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Team Member |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Creative |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Production |

**Workflows that resonate:**
- Client kickoff template → auto-creates 6 tasks.
- Weekly review of every active deliverable with mood-board screenshot proof.
- Recurring monthly retainer-task generation.

**AI notes show:**
- High-risk client engagements (overdue, no proof).
- Burnout risk on top performers.
- Top creators by completion rate.

**Reports useful:**
- Per-client weekly status export (JSON download).
- Department health for Creative vs Production.

**Sales angle:** "Replace your Notion-Slack-Asana sprawl. Every task has an owner, a deadline, a proof, and an audit trail."

---

## 3. Startups (small teams, 5–25 people)

**Pitch:** the execution OS for a founding team. Founders see company-wide queues, individual contributors see their own focus list, AI helps the founder spot bottlenecks. Built for teams that have outgrown Trello but don't want Jira.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Startup> Monitor |
| `VITE_CLIENT_TAGLINE` | Execution control |
| `VITE_CLIENT_INDUSTRY_LABEL` | Operations |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | AI Executive |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Founder |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Lead |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Team Member |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Product |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Engineering |

**Workflows that resonate:**
- Daily standup recurring task: each team member submits a 3-line proof of yesterday's progress.
- Sprint planning template.
- Founder Monday-morning review.

**AI notes show:**
- Founder execution health at a glance.
- High-risk tasks across teams.
- Inactive members (red flag for engagement).

**Sales angle:** "Replace Linear-meets-Notion for your founding team. One workspace, every action audited, AI summary every Monday."

---

## 4. Hospitals / clinics — operations side

**Pitch:** hospital admin / non-clinical workflow. Senior admin assigns tasks to floor staff; tasks have completion proofs (signed checklist, photo of equipment); department heads review. NOT for clinical patient management (HIPAA scope) — for operational tasks (cleaning, restocking, equipment checks, compliance).

**Disclosure:** the system is NOT HIPAA-certified out of the box. Do not promise clinical-data handling. Hospital admin is the safe scope.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Hospital> Ops |
| `VITE_CLIENT_TAGLINE` | Internal operations workspace |
| `VITE_CLIENT_INDUSTRY_LABEL` | Hospital Operations |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Care Operations Assistant |
| `VITE_CLIENT_ROLE_CEO_LABEL` | COO |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Department Head |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior Nurse / Senior Staff |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Staff Member |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Patient Services |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Facilities |

**Department add-ons (engineering task):** "Pharmacy", "Lab", "Admin". Add to `user_department()`.

**Workflows that resonate:**
- Daily-room-check recurring task with photo proof.
- Monthly compliance template (multi-step checklist).
- Senior nurse review queue for any flagged event.

**AI notes show:**
- Department-level compliance lapse risk.
- Stuck tasks past SLA.
- Staff burnout (high-load + low-output).

**Reports useful:**
- Monthly compliance summary (downloadable JSON).
- Audit log for quality/compliance.

**Sales angle:** "Operational accountability for hospital admin without touching clinical data. Every task tracked, every action audited."

---

## 5. Real estate teams

**Pitch:** brokerage workflow for property managers. Listings have tasks (viewings, repairs, paperwork). Agents submit proofs (photos, signed docs). Office head reviews. AI flags stalled deals.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Brokerage> Workspace |
| `VITE_CLIENT_TAGLINE` | Listings & operations |
| `VITE_CLIENT_INDUSTRY_LABEL` | Real Estate Office |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Operations Assistant |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Office Owner |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Office Manager |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior Agent |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Agent |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Sales |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Property Management |

**Workflows that resonate:**
- Listing-prep template: 8 steps from sign-in to MLS publish.
- Viewing-follow-up recurring task per agent.
- Repair-coordination template with vendor proof upload.

**AI notes show:**
- Stalled listings (no activity >14 days).
- Agent productivity by completed viewings.
- Compliance risk on outstanding paperwork.

**Sales angle:** "Track every listing from sign-in to close. Replace the per-agent spreadsheet chaos."

---

## 6. Sales teams (B2B SaaS, services)

**Pitch:** outbound + pipeline workflow. SDRs and AEs have assigned outreach + follow-up tasks. Sales managers review proofs (call summaries, emails sent). AI surfaces leaks in the pipeline.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | Pipeline Monitor |
| `VITE_CLIENT_TAGLINE` | Sales execution workspace |
| `VITE_CLIENT_INDUSTRY_LABEL` | Sales Team |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Sales Coach |
| `VITE_CLIENT_ROLE_CEO_LABEL` | VP Sales |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Sales Manager |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior AE |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | SDR / AE |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Inbound |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Outbound |

**Workflows that resonate:**
- Account-research template (5 steps before first call).
- Daily outreach recurring task (50 emails, 10 calls).
- Follow-up review queue for the manager.

**AI notes show:**
- Top performers + bottom performers this week.
- Pipeline stalls (deals with no activity).
- Outreach-volume lapses.

**Sales angle:** "Sales-team execution without a Salesforce admin. Every task tracked, every call reviewed, AI flags the gaps."

**Caveat:** this is NOT a CRM. It's a task / execution overlay. Pair with HubSpot / Salesforce if the client needs full pipeline data.

---

## 7. Internal operations teams (any company)

**Pitch:** the universal positioning. For any operations / chief-of-staff function in a company of 20–200. Tracks "everything that should happen this week", who's doing it, who's reviewing, where it's stalled.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Company> Operations |
| `VITE_CLIENT_TAGLINE` | Internal execution workspace |
| `VITE_CLIENT_INDUSTRY_LABEL` | Operations |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Operations Assistant |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Chief of Staff |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Operations Lead |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior Coordinator |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Coordinator |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | (department 1) |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | (department 2) |

This is the most flexible positioning. Useful when the client doesn't fit a vertical-specific pitch.

---

## 8. Generic enterprise — IT operations

**Pitch:** internal IT and infrastructure team. Tickets (tasks) get assigned, resolved with a proof, reviewed by senior engineers. AI flags ageing tickets and burnout.

| Setting | Value |
| --- | --- |
| `VITE_CLIENT_PRODUCT_NAME` | <Company> Ops |
| `VITE_CLIENT_TAGLINE` | Internal IT operations |
| `VITE_CLIENT_INDUSTRY_LABEL` | IT Operations |
| `VITE_CLIENT_AI_ASSISTANT_NAME` | Ops Bot |
| `VITE_CLIENT_ROLE_CEO_LABEL` | Director |
| `VITE_CLIENT_ROLE_FOUNDER_LABEL` | Manager |
| `VITE_CLIENT_ROLE_BOARD_LABEL` | Senior Engineer |
| `VITE_CLIENT_ROLE_INTERN_LABEL` | Engineer |
| `VITE_CLIENT_DEPT_FRONTEND_LABEL` | Support |
| `VITE_CLIENT_DEPT_BACKEND_LABEL` | Infrastructure |

---

## What does NOT work yet across all industries

Be honest in every sales conversation:

- **No native integrations** with Slack, Microsoft Teams, Salesforce, Jira, HubSpot, etc. We can recommend webhook-based add-ons in a future phase.
- **No email digest**. Notifications are in-app only.
- **No SSO**. Username/password via Supabase.
- **No client-portal UI**. The external-reviewer / client-viewer flow is documented in `MULTI_ORG_IMPLEMENTATION_PLAN.md` but not implemented.
- **No billing**. Payment is manual (your sales process handles invoicing).
- **Single-tenant only**. One deployment per customer. SaaS multi-tenant is a future phase.
- **No mobile app**. Responsive web only.
- **No file storage beyond inline base64 in proofs**. Large attachments require infrastructure work.
- **No custom fields on tasks**. Adding a new field requires a SQL migration.

These are not killers. They're scope choices. Be explicit so the client knows what they're buying.

---

## Universal sales playbook

For any industry above, your 25-minute demo (`CLIENT_DEMO_SCRIPT.md`) lands the same:

1. Show the CEO/Manager opening their Monday morning at `/home` — AI Executive Note + queues.
2. Switch to a department lead account — same dashboard but dept-scoped.
3. Switch to a team member account — focus-mode-ready execution view.
4. Walk a proof submission through to review + approval.
5. Show the admin diagnostics + audit log.

If the client says "what about X integration": acknowledge it's not built; offer to discuss in a Phase-2 conversation post-pilot.

---

## Per-industry quick reference table

| Industry | Product name | AI assistant | Top-level role |
| --- | --- | --- | --- |
| School | School Ops Hub | Operations Assistant | Principal |
| Agency | <Agency> Hub | Creative Director Assist | Founder |
| Startup | <Startup> Monitor | AI Executive | Founder |
| Hospital ops | <Hospital> Ops | Care Operations Assistant | COO |
| Real estate | <Brokerage> Workspace | Operations Assistant | Office Owner |
| Sales | Pipeline Monitor | Sales Coach | VP Sales |
| Internal ops | <Company> Operations | Operations Assistant | Chief of Staff |
| IT ops | <Company> Ops | Ops Bot | Director |

Use this as a starting point. Confirm with the client during the intake call (see `CLIENT_INTAKE_FORM.md`).

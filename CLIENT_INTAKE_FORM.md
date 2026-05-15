# Client Intake Form — Omni Monitor

Use this form to gather everything needed before deploying Omni Monitor for a new client. Send it as a Google Doc / Notion page / PDF. Most clients can fill it in 30 minutes; the AI section may take a follow-up call.

When complete, the answers feed directly into:
1. `CLIENT_DEPLOYMENT_TEMPLATE.md` § 3.4 (VITE_CLIENT_* env vars).
2. The Supabase `app_users` seed inserts in § 2.3.
3. The AI provider configuration in § 3.3.

---

## Section 1 — Company identity (visible everywhere in the app)

1. **Company name** (e.g., "Acme Corp"): __________________________
2. **Preferred product name** (e.g., "Acme Monitor", "Acme Ops", "Internal Hub"): __________________________
3. **Logo mark** — a 2-character abbreviation shown in NavBar and login. Default would be the first letter of each word of company name. (e.g., "AC" for Acme Corp): __________________________
4. **Tagline** — short phrase shown under the product name (e.g., "Execution control", "Internal operations", "Team workspace"): __________________________
5. **App heading** — appears on the login screen below the company name (e.g., "Execution OS", "Operations Hub"): __________________________
6. **Industry / workspace label** — short positioning. Examples: "Operations", "Construction", "Hospital Operations", "Sales Team", "School Administration", "Real Estate Office", "Agency Workspace", "Startup Ops". Pick one: __________________________

---

## Section 2 — Logo asset (optional but recommended)

Currently the app uses a text-based logo mark. If the client provides a real logo image we can wire it in (small engineering task):

- [ ] No logo image — text mark is fine.
- [ ] Logo provided — attach SVG (preferred) or transparent-background PNG.
- Image URL or attached file: __________________________

---

## Section 3 — AI assistant naming

The Executive Note card calls itself "AI Executive" by default. For a hospital it might be "Care Assistant", for a sales team "Sales Coach", for a school "Operations Assistant", for an agency "Project Brain".

- AI assistant name to display: __________________________

---

## Section 4 — Departments (display labels)

The system ships with two department buckets internally (`frontend`, `backend`). These are just internal keys — what users SEE can be relabelled per client. For a non-engineering client, common renames:

| Internal key | Default label | Client wants… |
| --- | --- | --- |
| `frontend` | Frontend | __________________________ |
| `backend`  | Backend  | __________________________ |

If your client needs MORE than two departments (e.g., a hospital with "Nursing", "Admin", "Surgery", "Pharmacy"), flag this — it requires extending `user_department()` in the SQL layer. Engineering handles that as a small one-off task.

Department count expected: __________________________

---

## Section 5 — Role display labels

The database has four roles: `CEO`, `FOUNDER`, `BOARD`, `INTERN`. These names are just internal enums — what users SEE can be relabelled. For a non-tech client, common renames:

| DB enum | Default label | Client wants… |
| --- | --- | --- |
| `CEO`     | CEO                  | __________________________ (e.g., "Director", "Owner", "Principal") |
| `FOUNDER` | Founder              | __________________________ (e.g., "Manager", "Lead", "Department Head") |
| `BOARD`   | Board / Dept Head    | __________________________ (e.g., "Supervisor", "Senior") |
| `INTERN`  | Intern               | __________________________ (e.g., "Team Member", "Associate", "Staff") |

Adding a fifth role (e.g., "Client") is NOT supported by the current code — that's a planned future phase. Confirm the four roles map to the client's hierarchy before proceeding.

---

## Section 6 — Users (admins to set up at launch)

List everyone who needs to be in the system on day one. The CEO is mandatory — they're the admin. Others are optional.

| # | Full name | Username (firstname.lastname) | Role (CEO/FOUNDER/BOARD/INTERN) | Job title | Department |
| - | --- | --- | --- | --- | --- |
| 1 | (the CEO) | | CEO | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |

Add more rows as needed. We seed all of these in the database during deployment.

**Note about department assignment:** users are placed in a department based on whether their `title` contains "frontend" or "backend" (case-insensitive), or via a hardcoded username list. For other industries we can extend the mapping — list any users whose department isn't obvious from their title here:

_______________________________________________

---

## Section 7 — Workflows + approval hierarchy

These influence training, not config — but they shape how you onboard the client.

7.1 **Who can assign tasks to whom?** (e.g., "CEO assigns to anyone; Founders assign within their department; Interns cannot assign"): _______________________________

7.2 **Who reviews submitted work?** (e.g., "Founders review their department's interns; CEO can override"): _______________________________

7.3 **Are proof images required for every submission, or optional?** (Default: required-on-submit checkbox.)
- [ ] Required (default)
- [ ] Optional (set `VITE_CLIENT_FEATURE_REQUIRE_PROOF=false`)

7.4 **Are recurring tasks needed at launch?** (e.g., "Daily standup notes", "Weekly board prep"):
- [ ] Yes — list 2–3 examples: _______________________________
- [ ] Not at launch

7.5 **Does the team use templates already?** (We can seed a few during onboarding): _______________________________

---

## Section 8 — AI requirements

8.1 **Does the client want the AI Executive Note feature?**
- [ ] Yes, with real AI (OpenAI or self-hosted Ollama).
- [ ] Yes, with mock/rule-based only (no external AI calls).
- [ ] No — disable AI entirely.

8.2 **If real AI: which provider?**
- [ ] OpenAI (we supply or they supply an API key)
- [ ] Hosted Ollama (they supply a URL and model)
- [ ] Self-hosted on their infra (they supply a URL we can reach)

8.3 **AI API key / provider URL** (if applicable): _______________________________

8.4 **Privacy / data residency requirements?** (e.g., "EU customers only", "No data leaves our infrastructure"): _______________________________

8.5 **Should AI mention employees by name?** (Today the AI may see task titles and assignee names. To eliminate that, set `AI_PROVIDER=mock`.)
- [ ] Yes (default — names allowed in AI summaries)
- [ ] No (force mock mode)

---

## Section 9 — Notifications

9.1 **In-app notifications only or email/Slack too?** (Today: in-app only. Email/Slack are future phases — flag if a blocker.)

9.2 **Are there any notification categories the client wants disabled?** (e.g., "Don't show strike notifications to non-CEO"): _______________________________

---

## Section 10 — Security requirements

10.1 **SSO requirement?** (e.g., Google SSO, Microsoft SSO, SAML.)
- [ ] No SSO required — username/password is fine.
- [ ] SSO required (this is a future-phase blocker — flag early).

10.2 **Audit log retention requirement?** (e.g., "Keep 7 years for compliance.")
- Required retention: _______________________________
- Note: today the system keeps everything indefinitely. Automated retention enforcement is a future phase.

10.3 **Data residency requirement?** (Pick the closest Supabase region in §2.1.)
- Required region: _______________________________

10.4 **Compliance frameworks?** (SOC 2 / HIPAA / GDPR / other)
- _______________________________

10.5 **Password policy?** (Today: bcrypt hashed, no complexity rules enforced. No self-serve reset.)
- Acceptable for launch? [ ] Yes / [ ] No (escalate)

---

## Section 11 — Custom wording (optional)

Any specific strings the client wants to override (`VITE_CLIENT_*` env vars):

| Where in the app | Default | Client's preferred wording |
| --- | --- | --- |
| Login description | "Private workspace for the team." | __________________________ |
| Empty dashboard hint | "Create a task to give the team a clear owner, outcome, and next step." | __________________________ |
| Finance card placeholder | "Financial and project tracking is reserved for a future phase..." | __________________________ |
| Onboarding banner (top of app, optional) | (empty — not shown) | __________________________ |

---

## Section 12 — Deployment + domain

12.1 **Domain strategy:**
- [ ] Vercel-provided subdomain (e.g., `acme-monitor.vercel.app`) — fine for trial.
- [ ] Custom subdomain (e.g., `monitor.acme.com`) — requires DNS access.

12.2 **DNS access:** if custom, the client must add a CNAME record. Email contact for DNS: _______________________________

12.3 **SSL:** Vercel handles automatically. Confirm the client is OK with Let's Encrypt: [ ] Yes / [ ] No

12.4 **Deployment region:** Vercel auto. Note: AI provider region may also matter — see §10.3.

---

## Section 13 — Support contact (to display in app + docs)

13.1 **Support email shown to end users:** _______________________________
   (Default: `support@omnimate.example`. Override via `VITE_CLIENT_SUPPORT_EMAIL`.)

13.2 **Support URL (optional, links from footer):** _______________________________
   (Override via `VITE_CLIENT_SUPPORT_URL`.)

13.3 **Escalation contact** for production incidents (internal use, not shown in app): _______________________________

---

## Section 14 — Sign-off

| | Name | Date | Notes |
| --- | --- | --- | --- |
| Client contact | __________ | __________ | __________ |
| Deployment lead | __________ | __________ | __________ |
| AI provider verified | __________ | __________ | __________ |
| QA pass complete | __________ | __________ | (after `INDUSTRY_READY_QA_CHECKLIST.md` ticked) |

---

## Appendix — Quick mapping from this form to env vars

```
Section 1.1  →  VITE_CLIENT_COMPANY_NAME
Section 1.2  →  VITE_CLIENT_PRODUCT_NAME
Section 1.3  →  VITE_CLIENT_LOGO_MARK
Section 1.4  →  VITE_CLIENT_TAGLINE
Section 1.5  →  VITE_CLIENT_APP_HEADING
Section 1.6  →  VITE_CLIENT_INDUSTRY_LABEL
Section 3    →  VITE_CLIENT_AI_ASSISTANT_NAME
Section 4    →  VITE_CLIENT_DEPT_FRONTEND_LABEL, VITE_CLIENT_DEPT_BACKEND_LABEL
Section 5    →  VITE_CLIENT_ROLE_CEO_LABEL, ..._FOUNDER_LABEL, ..._BOARD_LABEL, ..._INTERN_LABEL
Section 7.3  →  VITE_CLIENT_FEATURE_REQUIRE_PROOF
Section 8    →  AI_PROVIDER + OPENAI_API_KEY / OLLAMA_BASE_URL etc.
Section 11   →  VITE_CLIENT_LOGIN_DESCRIPTION, VITE_CLIENT_EMPTY_DASHBOARD_HINT, VITE_CLIENT_FINANCE_PLACEHOLDER, VITE_CLIENT_ONBOARDING_MESSAGE
Section 13.1 →  VITE_CLIENT_SUPPORT_EMAIL
Section 13.2 →  VITE_CLIENT_SUPPORT_URL
```

Hand the completed form to engineering. They run through `CLIENT_DEPLOYMENT_TEMPLATE.md` with these answers and you have a deployment in a few hours.

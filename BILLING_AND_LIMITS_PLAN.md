# Billing & Plans & Limits Plan — Omni Monitor

**Status:** Planning only. No payment code in this commit. No tables created.
**Companion:** `MULTI_ORG_IMPLEMENTATION_PLAN.md` step 8–9 (when this plan lands as implementation, it depends on workspaces existing first).

The current product has **no concept of money, plans, or limits**. This document specifies what to build, in what order, with which enforcement points.

---

## 1. Plan tiers (proposed)

Four tiers. Designed so that the Free tier is good enough for a single small team to validate the product, Starter starts paying, Pro fits SMB customers, Enterprise covers the white-label / on-prem story.

| Capability | Free | Starter | Pro | Enterprise |
| --- | --- | --- | --- | --- |
| Active users | 5 | 15 | 50 | unlimited |
| Active tasks (open at once) | 100 | 500 | 2,000 | unlimited |
| Storage (proof images, etc.) | 100 MB | 2 GB | 25 GB | 100 GB |
| Workspaces per billing account | 1 | 1 | 3 | unlimited |
| AI Executive Notes (per day) | 20 | 200 | 2,000 | unlimited |
| AI Reports (per month) | 4 | 50 | 500 | unlimited |
| Audit log retention | 30 days | 90 days | 1 year | 7 years |
| Recurring tasks | — | yes | yes | yes |
| Templates | basic | full | full | full |
| External reviewers | — | 2 | 10 | unlimited |
| Client portals | — | 1 | 5 | unlimited |
| Custom branding (L1) | — | — | yes | yes |
| Custom domain (L2) | — | — | — | yes |
| SSO / SAML | — | — | — | yes |
| Audit log export | — | CSV | CSV+JSON+webhook | + Splunk/Datadog |
| Support | community | email | priority | dedicated |
| Price (USD / month) | $0 | $79 | $249 | custom |
| Annual discount | — | 20% | 20% | custom |

Numbers are starting points for a Day-1 pricing page — they should be validated against actual cost-of-goods and a couple of design-partner conversations before anyone sees them.

---

## 2. Schema (DDL sketch — do not run)

Depends on `workspaces` from `MULTI_ORG_IMPLEMENTATION_PLAN.md`.

```sql
-- Plan catalog (seeded; rarely edited)
create table workspace_plans (
  plan_tier text primary key                 -- 'free','starter','pro','enterprise'
    check (plan_tier in ('free','starter','pro','enterprise')),
  display_name text not null,
  max_active_users int not null,
  max_active_tasks int not null,
  max_storage_mb int not null,
  max_workspaces int not null,
  ai_notes_per_day int not null,
  ai_reports_per_month int not null,
  audit_retention_days int not null,
  external_reviewers_allowed int not null,
  client_portals_allowed int not null,
  branding_level int not null default 0      -- 0=none, 1=logo+color, 2=domain, 3=full
  -- (more cols as features ship)
);

-- Per-workspace counters maintained by triggers/cron, NOT live-counted each request
create table workspace_usage (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  active_users int not null default 0,
  active_tasks int not null default 0,
  storage_mb int not null default 0,
  ai_notes_today int not null default 0,
  ai_notes_today_window timestamptz not null default now(),
  ai_reports_this_month int not null default 0,
  ai_reports_this_month_window timestamptz not null default now(),
  last_recomputed_at timestamptz not null default now()
);

-- Stripe (or equivalent) link
alter table workspaces add column stripe_customer_id text unique;
alter table workspaces add column stripe_subscription_id text;
alter table workspaces add column subscription_status text default 'trial'
  check (subscription_status in ('trial','active','past_due','canceled','suspended'));
alter table workspaces add column trial_ends_at timestamptz;
alter table workspaces add column current_period_end timestamptz;
```

---

## 3. Enforcement points

There are exactly two places where plan limits get checked. Anywhere else is a bug.

### 3.1 Soft check (UI hint)

Front-end calls `get_workspace_status_rpc` (new) on mount; receives `{plan_tier, usage, limits, percent_used}`. UI shows a banner at 80% and 100%. Pure UX — never blocks a request.

### 3.2 Hard check (RPC gate)

A new helper:
```sql
create function can_consume(p_workspace_id uuid, p_resource text, p_n int default 1)
returns boolean language sql stable as $$
  select coalesce(
    (select case p_resource
       when 'active_users' then plan.max_active_users >= usage.active_users + p_n
       when 'active_tasks' then plan.max_active_tasks >= usage.active_tasks + p_n
       when 'storage_mb'   then plan.max_storage_mb   >= usage.storage_mb   + p_n
       when 'ai_notes'     then plan.ai_notes_per_day >= usage.ai_notes_today + p_n
       when 'ai_reports'   then plan.ai_reports_per_month >= usage.ai_reports_this_month + p_n
       else false
     end
     from workspaces ws
     join workspace_plans plan on plan.plan_tier = ws.plan_tier
     left join workspace_usage usage on usage.workspace_id = ws.id
     where ws.id = p_workspace_id),
    false
  );
$$;
```

Every write RPC adds at the top:
```sql
if not can_consume(ws.id, 'active_tasks', 1) then
  return jsonb_build_object('ok',false,'error','Plan limit reached: active tasks',
                            'limit_kind','active_tasks');
end if;
```

The error payload carries `limit_kind` so the front-end can render a specific upgrade CTA.

### 3.3 RPCs that need a gate

| RPC | Resource consumed |
| --- | --- |
| `create_task_rpc`, `assign_task_template_rpc` (creating instances), `generate_due_tasks_rpc` | `active_tasks` |
| `add_log_rpc` (when `screenshot_data_url` is non-empty) | `storage_mb` (size of base64 / 1024) |
| `create_user_rpc` (does not exist yet) / invite accept flow | `active_users` |
| `requestAiAnalysis` boot probe + Executive Note path | `ai_notes` |
| `generate_ai_report_rpc` | `ai_reports` |

### 3.4 Suspended state

When `workspaces.status = 'suspended'`, every write RPC short-circuits with `Workspace suspended`. Reads remain allowed for 90 days as a grace period (to give the customer time to export their data) before becoming read-blocked.

---

## 4. Stripe (or equivalent) integration

Stripe is the assumption here because it is the lowest-friction option for v1. Switch to Paddle/LemonSqueezy if VAT / merchant-of-record is a hard requirement.

### 4.1 Stripe customer + subscription model

- One Stripe `Customer` per workspace, stored in `workspaces.stripe_customer_id`.
- One `Subscription` per Customer, with the `Price` keyed to the plan tier.
- `Price` IDs configured in env (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`).
- `Subscription` state mirrored to `workspaces.subscription_status` via webhook.

### 4.2 Customer-facing surface

- **Stripe Checkout** for the initial purchase. Hosted page, no PCI in our app.
- **Stripe Customer Portal** for plan changes, payment-method updates, and invoice download. Embedded via a Stripe portal session URL.
- **A `/billing` route under OWNER access** that links out to those.

### 4.3 Webhook endpoint

New serverless route: `/api/billing/webhook.js`. Verifies signature, then:

| Event | Action |
| --- | --- |
| `checkout.session.completed` | upsert workspace.subscription_status = 'active', set plan_tier from line items |
| `invoice.payment_failed` | set subscription_status = 'past_due', notify OWNER |
| `customer.subscription.updated` | re-sync plan_tier, current_period_end |
| `customer.subscription.deleted` | set subscription_status = 'canceled'; suspend in 30 days |

Idempotency: store `stripe_event_id` to avoid double-processing.

### 4.4 Trial flow

- New workspace starts with `subscription_status = 'trial'`, `trial_ends_at = now() + 14 days`, `plan_tier = 'starter'`.
- A nightly cron checks `where trial_ends_at < now() and subscription_status = 'trial'`:
  - If a Stripe subscription exists and is active → flip to `active`.
  - Otherwise → flip to `past_due`. After 7 more days `past_due` → `suspended`.

### 4.5 Cancellation

Cancellation in Stripe (customer portal) fires `subscription.deleted`. The workspace stays `active` until `current_period_end`, then automatically transitions to `canceled` → `suspended` per §3.4.

---

## 5. Front-end work

Discrete surfaces. Each maps to a screen or component.

- **Billing tab** under `/more` for OWNER role. Renders current plan, usage bars, "Manage subscription" button (link out to Stripe portal).
- **Upgrade banner** at the top of any page when usage > 80% on any resource. Dismissible per-session.
- **Hard-stop modal** when a write RPC returns `limit_kind`. Modal explains which limit and offers Upgrade CTA.
- **Trial countdown** in NavBar (replaces or accompanies the AI mode pill) — "X days left in trial". Disappears when subscription_status = 'active'.

All four are CSS + ~150 lines of React. Designed for 2 days of frontend work after the back-end lands.

---

## 6. Implementation order (within billing scope)

Depends on `MULTI_ORG_IMPLEMENTATION_PLAN.md` steps 1–6 having landed (workspaces, members, RBAC reshuffled).

```
B1. [0.5d] Add workspace_plans + workspace_usage tables; seed plan catalog;
           backfill workspace_usage from existing data (count tasks, count users,
           sum proof storage).

B2. [1d]   Add stripe_* columns to workspaces. Add subscription_status enum.
           Default all existing workspaces to plan_tier='enterprise' + status='active'
           (grandfather existing customers).

B3. [1d]   Add can_consume() helper + wire into create_task_rpc only as a pilot.
           Verify with a deliberate breakage test in staging.

B4. [1d]   Wire can_consume() into every other write RPC from §3.3.
           Add `limit_kind` to every error payload.

B5. [2d]   Stripe Checkout + Customer Portal + /api/billing/webhook.js.
           Test with Stripe test mode in staging.

B6. [1d]   Trial flow: trial_ends_at column, nightly cron, suspension state machine.

B7. [1d]   Front-end Billing tab + upgrade banner + hard-stop modal +
           trial countdown.

B8. [0.5d] Usage recompute cron. Updates workspace_usage every 5 minutes from
           authoritative table counts.

B9. [tbd]  Annual billing toggle, EU VAT handling, prorations, dunning emails.
```

Total: ~8 engineering days after multi-org steps 1–6 are done.

---

## 7. Risks

1. **Usage drift.** `workspace_usage` is a denormalized counter. Trigger maintenance + a recompute cron is the safe pattern; live-counting on every RPC call is the unsafe one (table scan in hot path).
2. **Plan downgrades.** A workspace currently on Pro with 30 users that downgrades to Starter (cap: 15) needs a grace period (30 days) and an OWNER-facing tool to deactivate excess users. Without it, an OWNER who self-downgrades creates an unresolvable state.
3. **Stripe webhook ordering.** Stripe does not guarantee event order. The webhook handler must be idempotent and resilient to out-of-order `subscription.updated` / `subscription.deleted` pairs.
4. **AI cost runaway.** The `ai_notes_per_day` and `ai_reports_per_month` limits prevent a customer from accidentally burning $$$ in OpenAI tokens. Make sure the can_consume() check is BEFORE the AI provider call, not after.
5. **Stripe API key rotation.** A leaked test key isn't catastrophic; a leaked production webhook secret allows forged events. Document the rotation procedure.
6. **Refunds / disputes.** Manual operation in v1 — point an admin at the Stripe dashboard. Add automation when MRR justifies it.

---

## 8. What this plan deliberately does NOT cover

- **Metered billing** (per-seat live counting + Stripe metered usage). v2.
- **Multi-currency / regional pricing**. v2.
- **Enterprise contracts / custom invoicing**. Manual sales process; not in product.
- **Refund automation**. Manual via Stripe dashboard in v1.
- **Affiliate / partner program**. Out of scope.
- **Trial-to-paid attribution**. Capture `signup_source` on `workspaces`; that's all.

---

## 9. Day-1 paid pilot recommendation

If the goal is to flip on payments for a single design-partner customer next month, the minimal viable set is:

- B1, B2: workspace_plans + workspace_usage + stripe_* columns.
- B5: a single Stripe Checkout link emailed to the customer that maps to a Pro subscription. Webhook handler only needs to flip `subscription_status` to `active`.
- Manually grandfather all other customers on Enterprise.
- Skip can_consume() enforcement entirely — generous early customer is on goodwill, not on plan limits.

Total effort: ~2 days. This is the "we are taking real money now" milestone without committing to the full billing infra.

After 2–3 paying customers exist, do the rest of B3–B9 properly.

---

## 10. Verdict

The billing plan is well-scoped and idempotently integrable. It is NOT the bottleneck — multi-org (`MULTI_ORG_IMPLEMENTATION_PLAN.md`) is. Without workspaces, every billing concept is meaningless because there is nothing to charge a tenant for.

Build multi-org first. Then layer billing in 8 days. Then turn on customers.

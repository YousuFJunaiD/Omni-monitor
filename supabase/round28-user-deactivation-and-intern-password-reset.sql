-- Phase 17: admin data cleanup.
--
-- Part A — Soft-deactivate three users (Polok Kumar, Mazen Ahmed, Ibrahim
--          Abdullah). We do NOT hard-delete because:
--            • tasks.assigned_to / assigned_by reference app_users.id with no
--              ON DELETE behaviour, so a DELETE would either fail or destroy
--              historical task ownership.
--            • proof_logs.user_id, time_logs.user_id, activity_events.actor_id,
--              audit_logs.actor_id, notifications.user_id, ai_report_runs.
--              initiated_by, ideas.submitted_by all reference app_users(id).
--            • The login/auth path already gates on `active = true`
--              (schema.sql:113 login_user, schema.sql:106 private_user_from_token),
--              so setting active=false instantly blocks login AND invalidates
--              any in-flight session token.
--
-- Part B — Rotate temporary passwords for every active INTERN. The new
--          passwords were generated locally by the admin with bcrypt
--          (rounds=10). Only the hashes are embedded in this migration —
--          plaintexts are NEVER written to source control. The admin shares
--          plaintexts with each intern out-of-band.
--
-- Idempotent: safe to re-run. The deactivation update is a no-op if already
-- inactive. The password updates always rotate to the hashes below; re-running
-- would re-apply the same hashes (admin should run only once per rotation).
--
-- Audit logs:
--   • USER_DEACTIVATED          — one row per deactivated user.
--   • INTERN_PASSWORD_RESET     — one row per intern whose password rotated.

-- ─── Part A — deactivate the three named users ──────────────────────────────
-- Match on BOTH username AND name for safety. If a user matches only username
-- but not name (or vice-versa), do nothing — protects against accidental hits
-- on a similar-username account.

update app_users
set active = false
where active = true
  and (
       (username = 'polok.k'     and name = 'Polok Kumar')
    or (username = 'mazen.ahmed' and name = 'Mazen Ahmed')
    or (username = 'ibrahim_cmo' and name = 'Ibrahim Abdullah')
  );

-- Invalidate any currently-issued session tokens for those users so an
-- already-logged-in browser session can't continue past its next RPC call.
delete from app_sessions
where user_id in (
  select id from app_users
  where active = false
    and username in ('polok.k', 'mazen.ahmed', 'ibrahim_cmo')
);

-- Audit trail. actor_id is null (system-level admin action).
insert into audit_logs(actor_id, action, target_table, target_id, meta)
select null, 'USER_DEACTIVATED', 'app_users', id,
  jsonb_build_object(
    'name', name,
    'username', username,
    'role', role,
    'title', title,
    'reason', 'admin cleanup (round28)',
    'method', 'soft_deactivate (active=false)'
  )
from app_users
where username in ('polok.k', 'mazen.ahmed', 'ibrahim_cmo')
  and active = false
  -- Avoid duplicate audit rows if the migration is re-run after a previous
  -- deactivation already audited the same users.
  and not exists (
    select 1 from audit_logs a
    where a.action = 'USER_DEACTIVATED'
      and a.target_id = app_users.id
  );

-- ─── Part B — rotate intern passwords ───────────────────────────────────────
-- Hashes were generated locally with bcrypt(rounds=10) and the plaintexts are
-- shared with the admin out-of-band. Only rows where active=true AND
-- role='INTERN' are updated, so a hash for a missing account is a no-op.

with new_hashes(username, password_hash) as (
  values
    ('aarzoo.anna',   '$2b$10$UpFLRHfegEY345zJCZ4E6ONVPpo1nbaZ8NGgkI5o0hmvxH3lVrUge'),
    ('ruqiya.n',      '$2b$10$68w53uBP8N3eWwgRg0R6OeNc/eDur33NV27KI6U3ulW2CPEx.1zDC'),
    ('syed.firas',    '$2b$10$HUx90sY0u4gO4lg.iKvo3uZxH0jHzu.mig.yWcNTIKZX2k.YfT8vy'),
    ('lotifur.r',     '$2b$10$0exyKSc24btKxgfZHHVh/OYwp643q8bO4.RdV0m9UjnR/OTtQmdSy'),
    ('akshaya.r',     '$2b$10$LhQr7ZLER5yM75GiR7COwO2MDigHS0RMS4eayWYGhQf7CV03pAOfu'),
    ('ismail.q',      '$2b$10$RL0Le2P6hYVV2fwNoViZaebSPIAO0fb5jGBF483u9DSV8cVLQlpMG'),
    ('mazharuddin.s', '$2b$10$PQk2JuT6BetE2DGfcCRtse4IisxNBdfIXKiJQfuInPVWn0AonOycq'),
    ('qatadah_sales', '$2b$10$EIusPUa2njKLD9AWifDROen2nF7xuUrlFCS2mPC1ezQJn30HE21sK')
)
update app_users u
set password_hash = h.password_hash
from new_hashes h
where u.username = h.username
  and u.role = 'INTERN'
  and u.active = true;

-- Kill any existing sessions for these interns so the rotation actually
-- forces a fresh login.
delete from app_sessions
where user_id in (
  select u.id from app_users u
  where u.username in (
    'aarzoo.anna','ruqiya.n','syed.firas','lotifur.r',
    'akshaya.r','ismail.q','mazharuddin.s','qatadah_sales'
  )
  and u.role = 'INTERN'
  and u.active = true
);

-- Audit trail per rotated intern.
insert into audit_logs(actor_id, action, target_table, target_id, meta)
select null, 'INTERN_PASSWORD_RESET', 'app_users', u.id,
  jsonb_build_object(
    'name', u.name,
    'username', u.username,
    'reason', 'admin temporary password rotation (round28)',
    'rotated_at', now()
  )
from app_users u
where u.username in (
  'aarzoo.anna','ruqiya.n','syed.firas','lotifur.r',
  'akshaya.r','ismail.q','mazharuddin.s','qatadah_sales'
)
  and u.role = 'INTERN'
  and u.active = true;

-- ─── Verification output for the admin ──────────────────────────────────────
-- After running this migration, this final query is what the Supabase SQL
-- editor displays. Confirm:
--   • 3 rows under "deactivated"
--   • all remaining interns listed under "active_interns"
--   • removed users have active=false

select 'deactivated' as kind, username, name, role, active
from app_users
where username in ('polok.k','mazen.ahmed','ibrahim_cmo')
union all
select 'active_intern' as kind, username, name, role, active
from app_users
where role = 'INTERN' and active = true
order by kind, name;

-- End of round 28.

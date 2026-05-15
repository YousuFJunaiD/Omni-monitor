-- Phase 12 follow-up: admin RPC RBAC hardening.
-- Revokes execute permission from `anon` on admin-only RPCs so unauthenticated
-- callers cannot reach the function name. The inner role check (`me.role <> 'CEO'`)
-- remains the authoritative gate; this migration is defense in depth.
--
-- Safe to run in production. Idempotent. No table changes. No function bodies
-- rewritten. The `authenticated` role keeps its grants so legitimate CEOs
-- continue to call these RPCs from the front-end with their session token.
--
-- After this migration:
--   • anon (unauthenticated browsers) → REJECTED at the Postgres permission
--     layer before any function body runs.
--   • authenticated (logged-in users) → must still satisfy the inner CEO check.
--
-- If you ever need to revert, re-run:
--   grant execute on function <signature> to anon;

-- ── Admin diagnostics (Phase 9) ──────────────────────────────────────────────
revoke execute on function get_audit_logs_rpc(text, int, int, text, uuid) from anon;
revoke execute on function get_system_health_rpc(text) from anon;

-- ── Strikes (CEO + assigner only) ────────────────────────────────────────────
revoke execute on function apply_strikes_rpc(text) from anon;
revoke execute on function moderate_strike_rpc(text, uuid, int, text) from anon;

-- ── Recurring task cron (CEO only) ───────────────────────────────────────────
revoke execute on function generate_due_tasks_rpc(text, date) from anon;

-- Sanity: verify the authenticated grant is still in place. If a previous
-- migration didn't add it (e.g. apply_strikes_rpc), grant it now to be safe.
grant execute on function get_audit_logs_rpc(text, int, int, text, uuid) to authenticated;
grant execute on function get_system_health_rpc(text) to authenticated;
grant execute on function apply_strikes_rpc(text) to authenticated;
grant execute on function moderate_strike_rpc(text, uuid, int, text) to authenticated;
grant execute on function generate_due_tasks_rpc(text, date) to authenticated;

-- End of round 22.

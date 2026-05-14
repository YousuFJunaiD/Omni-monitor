-- Phase 9: Audit Logs + System Health (read-only diagnostics for CEO/admin).
-- Adds two SECURITY DEFINER read RPCs over existing tables. Adds no new tables.
-- Does NOT modify any existing function — the audit_logs writers stay as they
-- are in earlier rounds. Three known gaps (template, recurring pause/resume,
-- AI report generation) are documented in the Phase 9 report; addressing them
-- requires touching round19/round20 in a focused follow-up.

-- ── get_audit_logs_rpc ────────────────────────────────────────────────────────
-- Lists audit_logs rows. CEO-only. Paginated. Optional filter by action prefix
-- and actor_id. Joins actor.name for display.
create or replace function get_audit_logs_rpc(
  p_token text,
  p_limit int default 50,
  p_offset int default 0,
  p_action text default null,
  p_actor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  items jsonb;
  total int;
  safe_limit int;
  safe_offset int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;
  if me.role <> 'CEO' then
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  safe_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  safe_offset := greatest(coalesce(p_offset, 0), 0);

  select jsonb_agg(row_to_json(x) order by x.created_at desc) into items
  from (
    select a.id, a.actor_id, actor.name as actor_name, actor.role as actor_role,
           a.action, a.target_table, a.target_id, a.meta, a.created_at
    from audit_logs a
    left join app_users actor on actor.id = a.actor_id
    where (p_action is null or p_action = '' or a.action ilike (p_action || '%'))
      and (p_actor_id is null or a.actor_id = p_actor_id)
    order by a.created_at desc
    limit safe_limit offset safe_offset
  ) x;

  select count(*)::int into total
  from audit_logs a
  where (p_action is null or p_action = '' or a.action ilike (p_action || '%'))
    and (p_actor_id is null or a.actor_id = p_actor_id);

  return jsonb_build_object(
    'ok', true,
    'items', coalesce(items, '[]'::jsonb),
    'total', total,
    'limit', safe_limit,
    'offset', safe_offset
  );
end; $$;

-- ── get_system_health_rpc ────────────────────────────────────────────────────
-- Aggregated diagnostics for CEO/admin dashboard. All counts are derived from
-- existing tables — no new failure-tracking tables are added.
--
-- Notes on what is and is NOT covered:
-- • failed_ai_reports: ai_report_runs.status = 'failed' (with error_message).
-- • stuck_under_review: tasks in UNDER_REVIEW for > 7 days.
-- • stuck_submitted: tasks in SUBMITTED for > 5 days (no reviewer picked up).
-- • overdue_unfinished: tasks past due_date and not in terminal states.
-- • paused_recurring: recurring_tasks where active = false.
-- • recent_audit_count: total audit_logs entries in the last 24 hours
--   (a rough activity heartbeat — sudden zero may indicate write failures).
-- NOT covered (would require new tracking infrastructure):
-- • failed_uploads        — proofs are inline data URIs, no upload table
-- • failed_rpc_calls      — RPC errors aren't currently logged anywhere
-- • auth_issues           — login_user doesn't differentiate success/failure
-- • failed_recurring_gen  — generate_due_tasks_rpc doesn't track per-row failures
create or replace function get_system_health_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  failed_ai_count int;
  failed_ai_recent jsonb;
  stuck_under_review_count int;
  stuck_under_review_items jsonb;
  stuck_submitted_count int;
  stuck_submitted_items jsonb;
  overdue_unfinished_count int;
  paused_recurring_count int;
  recent_audit_count int;
  recent_login_count int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then
    return jsonb_build_object('ok', false, 'error', 'Unauthorized');
  end if;
  if me.role <> 'CEO' then
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  -- Failed AI reports (last 30 days, count + 5 most recent)
  select count(*)::int into failed_ai_count
  from ai_report_runs
  where status = 'failed' and started_at >= now() - interval '30 days';

  select jsonb_agg(row_to_json(r) order by r.started_at desc) into failed_ai_recent
  from (
    select id, template_key, target_department, target_user_id, provider_used,
           error_message, started_at, completed_at
    from ai_report_runs
    where status = 'failed' and started_at >= now() - interval '30 days'
    order by started_at desc
    limit 5
  ) r;

  -- "Stuck" detection uses activity_events (max created_at per task) as the
  -- last-change signal, because the tasks table has no updated_at column.
  -- Falls back to tasks.created_at if no events exist for the task.
  -- The activity_events_task_created_idx makes this efficient per task.

  -- Tasks stuck in UNDER_REVIEW > 7 days (no review activity in 7d)
  select count(*)::int into stuck_under_review_count
  from tasks t
  where t.status = 'UNDER_REVIEW'
    and coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at)
        < now() - interval '7 days';

  select jsonb_agg(row_to_json(r) order by r.last_activity_at asc) into stuck_under_review_items
  from (
    select t.id, t.title, t.assigned_to, t.assigned_by, t.due_date, t.created_at,
           coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at) as last_activity_at
    from tasks t
    where t.status = 'UNDER_REVIEW'
      and coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at)
          < now() - interval '7 days'
    order by last_activity_at asc
    limit 10
  ) r;

  -- Tasks stuck in SUBMITTED/RESUBMITTED > 5 days (no reviewer picked up)
  select count(*)::int into stuck_submitted_count
  from tasks t
  where t.status in ('SUBMITTED', 'RESUBMITTED')
    and coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at)
        < now() - interval '5 days';

  select jsonb_agg(row_to_json(r) order by r.last_activity_at asc) into stuck_submitted_items
  from (
    select t.id, t.title, t.assigned_to, t.assigned_by, t.due_date, t.created_at,
           coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at) as last_activity_at
    from tasks t
    where t.status in ('SUBMITTED', 'RESUBMITTED')
      and coalesce((select max(created_at) from activity_events where task_id = t.id), t.created_at)
          < now() - interval '5 days'
    order by last_activity_at asc
    limit 10
  ) r;

  -- Tasks past due, not finished
  select count(*)::int into overdue_unfinished_count
  from tasks
  where status not in ('DONE', 'APPROVED', 'REJECTED')
    and due_date is not null
    and due_date < current_date;

  -- Paused recurring tasks
  select count(*)::int into paused_recurring_count
  from recurring_tasks
  where active = false;

  -- Recent activity heartbeat
  select count(*)::int into recent_audit_count
  from audit_logs
  where created_at >= now() - interval '24 hours';

  select count(*)::int into recent_login_count
  from audit_logs
  where action = 'LOGIN' and created_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'ok', true,
    'failed_ai_reports', jsonb_build_object(
      'count', failed_ai_count,
      'recent', coalesce(failed_ai_recent, '[]'::jsonb)
    ),
    'stuck_under_review', jsonb_build_object(
      'count', stuck_under_review_count,
      'items', coalesce(stuck_under_review_items, '[]'::jsonb)
    ),
    'stuck_submitted', jsonb_build_object(
      'count', stuck_submitted_count,
      'items', coalesce(stuck_submitted_items, '[]'::jsonb)
    ),
    'overdue_unfinished', overdue_unfinished_count,
    'paused_recurring', paused_recurring_count,
    'heartbeat', jsonb_build_object(
      'recent_audit_count_24h', recent_audit_count,
      'recent_login_count_24h', recent_login_count
    ),
    'generated_at', now()
  );
end; $$;

grant execute on function get_audit_logs_rpc(text, int, int, text, uuid) to anon, authenticated;
grant execute on function get_system_health_rpc(text) to anon, authenticated;

-- End of round 21.

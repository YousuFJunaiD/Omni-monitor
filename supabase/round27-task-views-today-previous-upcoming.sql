-- Phase 16: simplify Tasks tab views.
--
-- Two bugs being fixed:
--   1. Today's Tasks was showing FUTURE tasks. round17:277 had
--      `due_date=current_date OR due_date IS NULL OR due_date > current_date`
--      for the today filter. Tasks dated 18-May / 19-May / 20-May appeared
--      under Today. Today now means strictly due_date = current_date.
--   2. Users had no "Previous" or "Upcoming" views. Added both.
--
-- View definitions (after this migration):
--
--   today      due_date = current_date         AND not done/review/history
--              (strictly today, actionable)
--
--   previous   due_date < current_date         AND not done/history
--              (past-dated, not yet closed — includes review states; this is
--               the "what was missed before" view)
--
--   upcoming   due_date > current_date         AND not done/history
--              (future tasks not yet closed)
--
--   overdue    due_date < current_date         AND status in
--              (TODO, IN_PROGRESS, BLOCKED)
--              (truly stuck — past due AND no action taken yet; strict subset
--               of previous)
--
--   review     status in (SUBMITTED, UNDER_REVIEW, RESUBMITTED, CHANGES_REQUESTED)
--
--   history    status in (DONE, APPROVED, REJECTED)
--
-- RBAC, sorting behaviour, payload shape, and grants are unchanged.
-- Function signature unchanged. Idempotent. Safe to re-run.

create or replace function get_tasks_by_view_rpc(
  p_token text,
  p_view text default 'today',
  p_limit int default 80,
  p_offset int default 0
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  view_name text := coalesce(nullif(lower(p_view),''),'today');
  take_count int := least(greatest(coalesce(p_limit,80),1),200);
  skip_count int := greatest(coalesce(p_offset,0),0);
  payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if view_name not in ('today','previous','upcoming','overdue','review','history') then view_name := 'today'; end if;

  with visible_tasks as (
    select t.id,t.title,t.details,t.status,t.priority,t.due_date,t.created_at,t.completed_at,t.assigned_to,t.assigned_by,
      u.name assigned_to_name,u.role assignee_role,u.title assignee_title,u.username assignee_username,
      ab.name assigned_by_name,ab.role assigned_by_role
    from tasks t
    join app_users u on u.id=t.assigned_to
    left join app_users ab on ab.id=t.assigned_by
    where me.role='CEO'
      or t.assigned_to=me.id
      or can_review_task(me,t)
  ),
  filtered_tasks as (
    select * from visible_tasks
    where
      (view_name='today'
        and status not in ('DONE','APPROVED','REJECTED','SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED')
        and due_date = current_date)
      or (view_name='previous'
        and due_date is not null
        and due_date < current_date
        and status not in ('DONE','APPROVED','REJECTED'))
      or (view_name='upcoming'
        and due_date is not null
        and due_date > current_date
        and status not in ('DONE','APPROVED','REJECTED'))
      or (view_name='overdue'
        and due_date is not null
        and due_date < current_date
        and status in ('TODO','IN_PROGRESS','BLOCKED'))
      or (view_name='review'
        and status in ('SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED'))
      or (view_name='history'
        and status in ('DONE','APPROVED','REJECTED'))
  ),
  counts as (
    select
      count(*) filter(where
        status not in ('DONE','APPROVED','REJECTED','SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED')
        and due_date = current_date)::int today,
      count(*) filter(where
        due_date is not null and due_date < current_date
        and status not in ('DONE','APPROVED','REJECTED'))::int previous,
      count(*) filter(where
        due_date is not null and due_date > current_date
        and status not in ('DONE','APPROVED','REJECTED'))::int upcoming,
      count(*) filter(where
        due_date is not null and due_date < current_date
        and status in ('TODO','IN_PROGRESS','BLOCKED'))::int overdue,
      count(*) filter(where status in ('SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED'))::int review,
      count(*) filter(where status in ('DONE','APPROVED','REJECTED'))::int history
    from visible_tasks
  ),
  selected_tasks as (
    select * from filtered_tasks
    order by
      -- past-due first when looking at previous/overdue (oldest first)
      case when view_name in ('previous','overdue') then due_date end asc,
      -- soonest first when looking at upcoming
      case when view_name='upcoming' then due_date end asc,
      -- consistent secondary order
      case when view_name='today' then due_date end asc nulls last,
      created_at desc
    limit take_count offset skip_count
  ),
  minutes_by_task as (
    select tl.task_id, sum(tl.minutes)::int minutes_logged
    from time_logs tl join selected_tasks st on st.id=tl.task_id
    group by tl.task_id
  ),
  proof_stats as (
    select p.task_id, count(*)::int proof_count, max(p.created_at) last_proof_at
    from proof_logs p join selected_tasks st on st.id=p.task_id
    group by p.task_id
  ),
  task_items as (
    select jsonb_agg(jsonb_build_object(
      'id',st.id,'title',st.title,'details',st.details,'status',st.status,'priority',st.priority,
      'due_date',st.due_date,'created_at',st.created_at,'completed_at',st.completed_at,
      'assigned_to_id',st.assigned_to,'assigned_to_name',st.assigned_to_name,'assigned_to',st.assigned_to_name,
      'assignee_role',st.assignee_role,'assignee_title',st.assignee_title,'assignee_username',st.assignee_username,
      'assigned_by_id',st.assigned_by,'assigned_by_name',st.assigned_by_name,'assigned_by_role',st.assigned_by_role,
      'minutes_logged',coalesce(mbt.minutes_logged,0),'minutes',coalesce(mbt.minutes_logged,0),
      'proof_count',coalesce(ps.proof_count,0),'last_proof_at',ps.last_proof_at
    ) order by
      case when view_name in ('previous','overdue') then st.due_date end asc,
      case when view_name='upcoming' then st.due_date end asc,
      case when view_name='today' then st.due_date end asc nulls last,
      st.created_at desc) tasks
    from selected_tasks st
    left join minutes_by_task mbt on mbt.task_id=st.id
    left join proof_stats ps on ps.task_id=st.id
  )
  select jsonb_build_object(
    'ok',true,'view',view_name,'limit',take_count,'offset',skip_count,
    'counts',jsonb_build_object(
      'today',c.today,'previous',c.previous,'upcoming',c.upcoming,
      'overdue',c.overdue,'review',c.review,'history',c.history
    ),
    'tasks',coalesce(ti.tasks,'[]'::jsonb)
  )
  into payload
  from counts c cross join task_items ti;

  return coalesce(payload, jsonb_build_object(
    'ok',true,'view',view_name,'limit',take_count,'offset',skip_count,
    'counts',jsonb_build_object('today',0,'previous',0,'upcoming',0,'overdue',0,'review',0,'history',0),
    'tasks','[]'::jsonb
  ));
end; $$;

-- End of round 27.

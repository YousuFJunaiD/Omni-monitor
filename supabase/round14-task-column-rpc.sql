-- Column-oriented task list RPC.
-- Keeps list payload light and moves comments/proof history/activity to detail RPCs.

create index if not exists idx_tasks_due_status_created on tasks(due_date, status, created_at desc);
create index if not exists idx_tasks_assigned_to_due_status on tasks(assigned_to, due_date, status);
create index if not exists idx_tasks_created_at_desc on tasks(created_at desc);
create index if not exists idx_time_logs_task_id on time_logs(task_id);
create index if not exists idx_proof_logs_task_created on proof_logs(task_id, created_at desc);

create or replace function user_department(p_user app_users)
returns text language sql stable as $$
  select case
    when p_user.username in ('aarzoo.anna','ruqiya.n','mazen.ahmed','polok.k','syed.firas','lotifur.r')
      or lower(coalesce(p_user.title,'')) like '%frontend%'
      or lower(coalesce(p_user.title,'')) like '%cpo%'
      or lower(coalesce(p_user.title,'')) like '%cxo%'
      then 'frontend'
    when p_user.username in ('akshaya.r','ismail.q','mazharuddin.s')
      or lower(coalesce(p_user.title,'')) like '%backend%'
      or lower(coalesce(p_user.title,'')) like '%cto%'
      or lower(coalesce(p_user.title,'')) like '%csa%'
      then 'backend'
    else ''
  end
$$;

drop function if exists get_tasks_rpc(text);

create or replace function get_tasks_rpc(
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
  tasks_payload jsonb;
  counts_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then
    return jsonb_build_object('ok',false,'error','Unauthorized');
  end if;

  if view_name not in ('today','overdue','review','history') then
    view_name := 'today';
  end if;

  with visible_tasks as (
    select
      t.id,
      t.title,
      t.details,
      t.status,
      t.priority,
      t.due_date,
      t.created_at,
      t.completed_at,
      t.assigned_to,
      t.assigned_by,
      u.name assigned_to_name,
      u.role assignee_role,
      u.title assignee_title,
      u.username assignee_username,
      ab.name assigned_by_name,
      ab.role assigned_by_role
    from tasks t
    join app_users u on u.id = t.assigned_to
    left join app_users ab on ab.id = t.assigned_by
    where me.role = 'CEO'
      or t.assigned_to = me.id
      or (
        me.role in ('BOARD','FOUNDER')
        and u.role = 'INTERN'
        and user_department(me) <> ''
        and user_department(me) = user_department(u)
      )
  ),
  counts as (
    select
      count(*) filter(where status not in ('DONE','SUBMITTED') and (due_date = current_date or due_date is null or due_date > current_date))::int today,
      count(*) filter(where due_date < current_date and status <> 'DONE')::int overdue,
      count(*) filter(where status = 'SUBMITTED')::int review,
      count(*) filter(where status = 'DONE')::int history
    from visible_tasks
  ),
  selected as (
    select *
    from visible_tasks
    where
      (view_name = 'today' and status not in ('DONE','SUBMITTED') and (due_date = current_date or due_date is null or due_date > current_date))
      or (view_name = 'overdue' and due_date < current_date and status <> 'DONE')
      or (view_name = 'review' and status = 'SUBMITTED')
      or (view_name = 'history' and status = 'DONE')
    order by
      case when view_name = 'overdue' then due_date end asc,
      case when view_name = 'today' then due_date end asc nulls last,
      created_at desc
    limit take_count offset skip_count
  ),
  minutes_by_task as (
    select tl.task_id, sum(tl.minutes)::int minutes_logged
    from time_logs tl
    join selected s on s.id = tl.task_id
    group by tl.task_id
  ),
  proof_stats as (
    select p.task_id, count(*)::int proof_count, max(p.created_at) last_proof_at
    from proof_logs p
    join selected s on s.id = p.task_id
    group by p.task_id
  )
  select jsonb_agg(jsonb_build_object(
    'id',s.id,
    'title',s.title,
    'details',s.details,
    'status',s.status,
    'priority',s.priority,
    'due_date',s.due_date,
    'created_at',s.created_at,
    'completed_at',s.completed_at,
    'assigned_to_id',s.assigned_to,
    'assigned_to_name',s.assigned_to_name,
    'assigned_to',s.assigned_to_name,
    'assignee_role',s.assignee_role,
    'assignee_title',s.assignee_title,
    'assignee_username',s.assignee_username,
    'assigned_by_id',s.assigned_by,
    'assigned_by_name',s.assigned_by_name,
    'assigned_by_role',s.assigned_by_role,
    'minutes_logged',coalesce(mbt.minutes_logged,0),
    'minutes',coalesce(mbt.minutes_logged,0),
    'proof_count',coalesce(ps.proof_count,0),
    'last_proof_at',ps.last_proof_at
  ) order by
    case when view_name = 'overdue' then s.due_date end asc,
    case when view_name = 'today' then s.due_date end asc nulls last,
    s.created_at desc)
  into tasks_payload
  from selected s
  left join minutes_by_task mbt on mbt.task_id = s.id
  left join proof_stats ps on ps.task_id = s.id;

  select jsonb_build_object('today',today,'overdue',overdue,'review',review,'history',history)
  into counts_payload
  from counts;

  return jsonb_build_object(
    'ok',true,
    'view',view_name,
    'limit',take_count,
    'offset',skip_count,
    'counts',coalesce(counts_payload,jsonb_build_object('today',0,'overdue',0,'review',0,'history',0)),
    'tasks',coalesce(tasks_payload,'[]'::jsonb)
  );
end; $$;

grant execute on function get_tasks_rpc(text, text, int, int) to anon, authenticated;
grant execute on function user_department(app_users) to anon, authenticated;

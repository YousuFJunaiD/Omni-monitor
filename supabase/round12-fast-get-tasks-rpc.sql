-- Fast task list RPC.
-- Task cards should stay lightweight; comments, proof history, screenshots,
-- and activity belong in get_task_by_id_rpc when a task is opened.

create index if not exists idx_tasks_created_at_desc on tasks(created_at desc);
create index if not exists idx_tasks_assigned_to_created on tasks(assigned_to, created_at desc);
create index if not exists idx_tasks_status_created on tasks(status, created_at desc);
create index if not exists idx_time_logs_task_id on time_logs(task_id);
create index if not exists idx_proof_logs_task_id on proof_logs(task_id);

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

create or replace function get_tasks_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  tasks_payload jsonb;
  my_department text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then
    return jsonb_build_object('ok',false,'error','Unauthorized');
  end if;

  my_department := user_department(me);

  if me.role = 'CEO' then
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
      order by t.created_at desc
      limit 500
    ),
    minutes_by_task as (
      select tl.task_id, sum(tl.minutes)::int minutes_logged
      from time_logs tl
      join visible_tasks vt on vt.id = tl.task_id
      group by tl.task_id
    ),
    proof_counts as (
      select p.task_id, count(*)::int proof_count
      from proof_logs p
      join visible_tasks vt on vt.id = p.task_id
      group by p.task_id
    )
    select jsonb_agg(jsonb_build_object(
      'id',vt.id,
      'title',vt.title,
      'details',vt.details,
      'status',vt.status,
      'priority',vt.priority,
      'due_date',vt.due_date,
      'created_at',vt.created_at,
      'completed_at',vt.completed_at,
      'assigned_to_id',vt.assigned_to,
      'assigned_to_name',vt.assigned_to_name,
      'assigned_to',vt.assigned_to_name,
      'assignee_role',vt.assignee_role,
      'assignee_title',vt.assignee_title,
      'assignee_username',vt.assignee_username,
      'assigned_by_id',vt.assigned_by,
      'assigned_by_name',vt.assigned_by_name,
      'assigned_by_role',vt.assigned_by_role,
      'minutes_logged',coalesce(mbt.minutes_logged,0),
      'minutes',coalesce(mbt.minutes_logged,0),
      'proof_count',coalesce(pc.proof_count,0)
    ) order by vt.created_at desc)
    into tasks_payload
    from visible_tasks vt
    left join minutes_by_task mbt on mbt.task_id = vt.id
    left join proof_counts pc on pc.task_id = vt.id;
  elsif me.role = 'INTERN' then
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
      where t.assigned_to = me.id
      order by t.created_at desc
      limit 500
    ),
    minutes_by_task as (
      select tl.task_id, sum(tl.minutes)::int minutes_logged
      from time_logs tl
      join visible_tasks vt on vt.id = tl.task_id
      group by tl.task_id
    ),
    proof_counts as (
      select p.task_id, count(*)::int proof_count
      from proof_logs p
      join visible_tasks vt on vt.id = p.task_id
      group by p.task_id
    )
    select jsonb_agg(jsonb_build_object(
      'id',vt.id,
      'title',vt.title,
      'details',vt.details,
      'status',vt.status,
      'priority',vt.priority,
      'due_date',vt.due_date,
      'created_at',vt.created_at,
      'completed_at',vt.completed_at,
      'assigned_to_id',vt.assigned_to,
      'assigned_to_name',vt.assigned_to_name,
      'assigned_to',vt.assigned_to_name,
      'assignee_role',vt.assignee_role,
      'assignee_title',vt.assignee_title,
      'assignee_username',vt.assignee_username,
      'assigned_by_id',vt.assigned_by,
      'assigned_by_name',vt.assigned_by_name,
      'assigned_by_role',vt.assigned_by_role,
      'minutes_logged',coalesce(mbt.minutes_logged,0),
      'minutes',coalesce(mbt.minutes_logged,0),
      'proof_count',coalesce(pc.proof_count,0)
    ) order by vt.created_at desc)
    into tasks_payload
    from visible_tasks vt
    left join minutes_by_task mbt on mbt.task_id = vt.id
    left join proof_counts pc on pc.task_id = vt.id;
  else
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
      where t.assigned_to = me.id
        or (
          me.role in ('BOARD','FOUNDER')
          and u.role = 'INTERN'
          and my_department <> ''
          and user_department(u) = my_department
        )
      order by t.created_at desc
      limit 500
    ),
    minutes_by_task as (
      select tl.task_id, sum(tl.minutes)::int minutes_logged
      from time_logs tl
      join visible_tasks vt on vt.id = tl.task_id
      group by tl.task_id
    ),
    proof_counts as (
      select p.task_id, count(*)::int proof_count
      from proof_logs p
      join visible_tasks vt on vt.id = p.task_id
      group by p.task_id
    )
    select jsonb_agg(jsonb_build_object(
      'id',vt.id,
      'title',vt.title,
      'details',vt.details,
      'status',vt.status,
      'priority',vt.priority,
      'due_date',vt.due_date,
      'created_at',vt.created_at,
      'completed_at',vt.completed_at,
      'assigned_to_id',vt.assigned_to,
      'assigned_to_name',vt.assigned_to_name,
      'assigned_to',vt.assigned_to_name,
      'assignee_role',vt.assignee_role,
      'assignee_title',vt.assignee_title,
      'assignee_username',vt.assignee_username,
      'assigned_by_id',vt.assigned_by,
      'assigned_by_name',vt.assigned_by_name,
      'assigned_by_role',vt.assigned_by_role,
      'minutes_logged',coalesce(mbt.minutes_logged,0),
      'minutes',coalesce(mbt.minutes_logged,0),
      'proof_count',coalesce(pc.proof_count,0)
    ) order by vt.created_at desc)
    into tasks_payload
    from visible_tasks vt
    left join minutes_by_task mbt on mbt.task_id = vt.id
    left join proof_counts pc on pc.task_id = vt.id;
  end if;

  return jsonb_build_object('ok',true,'tasks',coalesce(tasks_payload,'[]'::jsonb));
end; $$;

grant execute on function get_tasks_rpc(text) to anon, authenticated;
grant execute on function user_department(app_users) to anon, authenticated;

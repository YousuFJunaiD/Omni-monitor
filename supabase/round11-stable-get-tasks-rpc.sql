-- Stabilize task loading after department RBAC.
-- Keeps the round10 visibility rules, but avoids per-task proof/time scans.

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

create or replace function can_assign_department_task(p_manager app_users, p_target app_users)
returns boolean language sql stable as $$
  select case
    when p_manager.id is null or p_target.id is null then false
    when p_target.role = 'CEO' then false
    when p_manager.role = 'CEO' then true
    when p_manager.role in ('BOARD','FOUNDER')
      then p_target.role = 'INTERN'
        and user_department(p_manager) <> ''
        and user_department(p_manager) = user_department(p_target)
    else false
  end
$$;

create or replace function get_tasks_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  tasks_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then
    return jsonb_build_object('ok',false,'error','Unauthorized');
  end if;

  with visible_tasks as (
    select
      t.*,
      u.name assigned_to_name,
      u.id assigned_to_user_id,
      u.role assignee_role,
      u.title assignee_title,
      u.username assignee_username,
      u.avatar_data_url assignee_avatar_data_url,
      ab.id assigned_by_user_id,
      ab.name assigned_by_name,
      ab.role assigned_by_role,
      ab.avatar_data_url assigner_avatar_data_url
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
  minutes_by_task as (
    select tl.task_id, sum(tl.minutes)::int minutes
    from time_logs tl
    join visible_tasks vt on vt.id = tl.task_id
    group by tl.task_id
  ),
  proofs_by_task as (
    select p.task_id,
      jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'note',p.note,
          'is_submission',p.is_submission,
          'created_at',p.created_at,
          'screenshot_data_url',p.screenshot_data_url
        )
        order by p.created_at desc
      ) proofs
    from proof_logs p
    join visible_tasks vt on vt.id = p.task_id
    group by p.task_id
  )
  select jsonb_agg(
    jsonb_build_object(
      'id',vt.id,
      'title',vt.title,
      'details',vt.details,
      'status',vt.status,
      'priority',vt.priority,
      'due_date',vt.due_date,
      'strike_applied',vt.strike_applied,
      'assigned_to',vt.assigned_to_name,
      'assigned_to_id',vt.assigned_to_user_id,
      'assignee_role',vt.assignee_role,
      'assignee_title',vt.assignee_title,
      'assignee_username',vt.assignee_username,
      'assignee_avatar_data_url',vt.assignee_avatar_data_url,
      'assigned_by_id',vt.assigned_by_user_id,
      'assigned_by_name',vt.assigned_by_name,
      'assigned_by_role',vt.assigned_by_role,
      'assigner_avatar_data_url',vt.assigner_avatar_data_url,
      'created_at',vt.created_at,
      'completed_at',vt.completed_at,
      'minutes',coalesce(mbt.minutes,0),
      'proofs',coalesce(pbt.proofs,'[]'::jsonb)
    )
    order by vt.created_at desc
  )
  into tasks_payload
  from visible_tasks vt
  left join minutes_by_task mbt on mbt.task_id = vt.id
  left join proofs_by_task pbt on pbt.task_id = vt.id;

  return jsonb_build_object('ok',true,'tasks',coalesce(tasks_payload,'[]'::jsonb));
exception when others then
  return jsonb_build_object(
    'ok',false,
    'tasks','[]'::jsonb,
    'error','Unable to load tasks: ' || sqlerrm
  );
end; $$;

grant execute on function user_department(app_users) to anon, authenticated;
grant execute on function can_assign_department_task(app_users, app_users) to anon, authenticated;
grant execute on function get_tasks_rpc(text) to anon, authenticated;

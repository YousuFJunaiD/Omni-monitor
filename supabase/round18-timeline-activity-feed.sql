-- Phase 3: task timeline + RBAC-aware activity feed.
-- Uses existing activity_events; no reset and no heavy task/proof payloads.

create index if not exists idx_activity_events_created_at on activity_events(created_at desc);
create index if not exists idx_activity_events_task_created_at on activity_events(task_id, created_at desc);
create index if not exists idx_activity_events_target_created_at on activity_events(target_kind, target_id, created_at desc);

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

create or replace function can_review_task(p_reviewer app_users, p_task tasks)
returns boolean language plpgsql stable as $$
declare assignee app_users;
begin
  if p_reviewer.id is null or p_task.id is null then return false; end if;
  if p_reviewer.role = 'CEO' then return true; end if;
  if p_task.assigned_by = p_reviewer.id then return true; end if;
  select * into assignee from app_users where id=p_task.assigned_to;
  return p_reviewer.role in ('BOARD','FOUNDER')
    and assignee.role = 'INTERN'
    and user_department(p_reviewer) <> ''
    and user_department(p_reviewer) = user_department(assignee);
end; $$;

create or replace function can_view_review_task(p_viewer app_users, p_task tasks)
returns boolean language plpgsql stable as $$
begin
  if p_viewer.id is null or p_task.id is null then return false; end if;
  return p_viewer.role = 'CEO'
    or p_task.assigned_to = p_viewer.id
    or can_review_task(p_viewer, p_task);
end; $$;

create or replace function can_view_activity_user(p_viewer app_users, p_target app_users)
returns boolean language sql stable as $$
  select case
    when p_viewer.id is null or p_target.id is null then false
    when p_viewer.role = 'CEO' then true
    when p_viewer.id = p_target.id then true
    when p_viewer.role in ('BOARD','FOUNDER')
      then p_target.role = 'INTERN'
        and user_department(p_viewer) <> ''
        and user_department(p_viewer) = user_department(p_target)
    else false
  end
$$;

create or replace function activity_display_body(p_event_type text, p_body text)
returns text language sql stable as $$
  select coalesce(nullif(p_body,''), case p_event_type
    when 'TASK_CREATED' then 'Task created'
    when 'TASK_ASSIGNED' then 'Task assigned'
    when 'TASK_UPDATED' then 'Task updated'
    when 'DEADLINE_CHANGED' then 'Deadline changed'
    when 'STATUS_CHANGED' then 'Status changed'
    when 'TASK_COMPLETED' then 'Task completed'
    when 'PROOF_SUBMITTED' then 'Proof submitted'
    when 'RESUBMITTED' then 'Task resubmitted'
    when 'OPEN_REVIEW' then 'Review opened'
    when 'APPROVE' then 'Task approved'
    when 'REQUEST_CHANGES' then 'Changes requested'
    when 'REJECT' then 'Task rejected'
    when 'COMMENT_ADDED' then 'Comment added'
    when 'MANUAL_STRIKE_ADD' then 'Strike added'
    when 'MANUAL_STRIKE_REMOVE' then 'Strike removed'
    when 'STRIKE_APPLIED' then 'Strike added'
    else initcap(replace(coalesce(p_event_type,'Activity'),'_',' '))
  end)
$$;

create or replace function update_task_rpc(p_token text, p_task_id uuid, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; old_assigned_to uuid; old_due_date date; target_user app_users; updated_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_manage_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Task title is required'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if not can_assign_department_task(me, target_user) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed to assign this user');
  end if;

  old_assigned_to := task_row.assigned_to;
  old_due_date := task_row.due_date;
  update tasks
  set title=trim(p_title), details=coalesce(p_details,''), assigned_to=p_assigned_to, priority=p_priority, due_date=p_due_date
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date,'department',user_department(target_user)));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_UPDATED','task',p_task_id,p_task_id,'Task updated',jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date,'department',user_department(target_user)));

  if old_due_date is distinct from p_due_date then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'DEADLINE_CHANGED','task',p_task_id,p_task_id,'Deadline changed',jsonb_build_object('from',old_due_date,'to',p_due_date));
  end if;

  if old_assigned_to is distinct from p_assigned_to then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_ASSIGNED','task',p_task_id,p_task_id,'Task reassigned',jsonb_build_object('from',old_assigned_to,'to',p_assigned_to,'department',user_department(target_user)));
    perform round4_notify(p_token,me.id,p_assigned_to,'TASK_ASSIGNED','Task assigned to you',updated_task.title,'task',updated_task.id);
  end if;

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

create or replace function get_activity_timeline_rpc(p_token text, p_limit int default 50, p_task_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; payload jsonb; safe_limit int; requested_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  safe_limit := least(greatest(coalesce(p_limit,50),1),100);

  if p_task_id is not null then
    select * into requested_task from tasks where id=p_task_id;
    if requested_task.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
    if not can_view_review_task(me, requested_task) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  end if;

  select jsonb_agg(row_to_json(x) order by x.created_at asc) into payload
  from (
    select e.id::text id,e.actor_id,a.name actor_name,a.role actor_role,e.event_type,e.target_kind,e.target_id,e.task_id,
      activity_display_body(e.event_type,e.body) body,e.meta,e.created_at,t.title task_title,u.name assignee_name
    from activity_events e
    left join app_users a on a.id=e.actor_id
    left join tasks t on t.id=e.task_id
    left join app_users u on u.id=t.assigned_to
    where (p_task_id is null or e.task_id=p_task_id)
      and (
        (e.task_id is not null and can_view_review_task(me,t))
        or (e.task_id is null and e.target_kind='user' and exists (
          select 1 from app_users target_user where target_user.id=e.target_id and can_view_activity_user(me,target_user)
        ))
        or e.actor_id=me.id
      )
    order by e.created_at desc
    limit safe_limit
  ) x;

  return jsonb_build_object('ok',true,'data',coalesce(payload,'[]'::jsonb),'error',null);
end; $$;

create or replace function get_activity_feed_rpc(p_token text, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; payload jsonb; safe_limit int; safe_offset int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'items','[]'::jsonb,'error','Unauthorized'); end if;
  safe_limit := least(greatest(coalesce(p_limit,50),1),50);
  safe_offset := greatest(coalesce(p_offset,0),0);

  with event_rows as (
    select e.id::text id,e.actor_id,a.name actor_name,a.role actor_role,e.event_type,e.target_kind,e.target_id,e.task_id,
      activity_display_body(e.event_type,e.body) body,e.meta,e.created_at,t.title task_title,u.name assignee_name,u.id assignee_id
    from activity_events e
    left join app_users a on a.id=e.actor_id
    left join tasks t on t.id=e.task_id
    left join app_users u on u.id=t.assigned_to
    where e.event_type in (
      'TASK_CREATED','TASK_ASSIGNED','TASK_UPDATED','DEADLINE_CHANGED','STATUS_CHANGED','TASK_COMPLETED',
      'PROOF_SUBMITTED','RESUBMITTED','OPEN_REVIEW','APPROVE','REQUEST_CHANGES','REJECT',
      'COMMENT_ADDED','MANUAL_STRIKE_ADD','MANUAL_STRIKE_REMOVE','STRIKE_APPLIED'
    )
      and (
        (e.task_id is not null and can_view_review_task(me,t))
        or (e.task_id is null and e.target_kind='user' and exists (
          select 1 from app_users target_user where target_user.id=e.target_id and can_view_activity_user(me,target_user)
        ))
        or e.actor_id=me.id
      )
  ),
  overdue_rows as (
    select ('overdue-' || t.id::text) id,null::uuid actor_id,'System' actor_name,null::app_role actor_role,'TASK_OVERDUE' event_type,
      'task' target_kind,t.id target_id,t.id task_id,'Task overdue' body,
      jsonb_build_object('due_date',t.due_date) meta,(t.due_date + time '23:59:59')::timestamptz created_at,
      t.title task_title,u.name assignee_name,u.id assignee_id
    from tasks t
    join app_users u on u.id=t.assigned_to
    where t.due_date < current_date
      and t.status not in ('DONE','APPROVED','REJECTED')
      and can_view_review_task(me,t)
  ),
  unioned as (
    select * from event_rows
    union all
    select * from overdue_rows
  )
  select jsonb_agg(row_to_json(x) order by x.created_at desc) into payload
  from (
    select * from unioned
    order by created_at desc
    limit safe_limit offset safe_offset
  ) x;

  return jsonb_build_object('ok',true,'items',coalesce(payload,'[]'::jsonb),'limit',safe_limit,'offset',safe_offset,'error',null);
end; $$;

grant execute on function can_view_activity_user(app_users, app_users) to anon, authenticated;
grant execute on function activity_display_body(text, text) to anon, authenticated;
grant execute on function get_activity_timeline_rpc(text, int, uuid) to anon, authenticated;
grant execute on function get_activity_feed_rpc(text, int, int) to anon, authenticated;

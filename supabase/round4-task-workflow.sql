-- supabase/round4-task-workflow.sql
-- Round 4 migration. Non-destructive, idempotent.
-- Adds: task comments, activity timeline, task workflow RPCs.
-- Replaces task/proof/strike RPC bodies without changing existing table data.
-- Does not modify schema.sql and does not add broad RLS policies.

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists task_comments_task_created_idx
  on task_comments(task_id, created_at desc);

alter table task_comments enable row level security;

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_users(id) on delete set null,
  event_type text not null,
  target_kind text not null,
  target_id uuid not null,
  task_id uuid references tasks(id) on delete cascade,
  body text default '',
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);

create index if not exists activity_events_task_created_idx
  on activity_events(task_id, created_at desc);

create index if not exists activity_events_created_idx
  on activity_events(created_at desc);

alter table activity_events enable row level security;

create or replace function round4_task_json(p_task tasks)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p_task.id,
    'title',p_task.title,
    'details',p_task.details,
    'status',p_task.status,
    'priority',p_task.priority,
    'due_date',p_task.due_date,
    'strike_applied',p_task.strike_applied,
    'assigned_to_id',p_task.assigned_to,
    'assigned_to_name',(select name from app_users where id=p_task.assigned_to),
    'assigned_to_role',(select role from app_users where id=p_task.assigned_to),
    'assigned_by_id',p_task.assigned_by,
    'assigned_by_name',(select name from app_users where id=p_task.assigned_by),
    'assigned_by_role',(select role from app_users where id=p_task.assigned_by),
    'created_at',p_task.created_at,
    'completed_at',p_task.completed_at,
    'minutes',coalesce((select sum(minutes) from time_logs where task_id=p_task.id),0)
  );
$$;

create or replace function round4_can_view_task(p_user app_users, p_task tasks)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare assignee app_users;
begin
  if p_user.id is null or p_task.id is null then return false; end if;
  select * into assignee from app_users where id=p_task.assigned_to;
  return p_user.role='CEO'
    or (p_user.role='BOARD' and assignee.role='INTERN')
    or (p_user.role='FOUNDER' and (p_task.assigned_to=p_user.id or assignee.role='INTERN'))
    or (p_user.role='INTERN' and p_task.assigned_to=p_user.id);
end; $$;

create or replace function round4_can_manage_task(p_user app_users, p_task tasks)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare assignee app_users;
begin
  if p_user.id is null or p_task.id is null then return false; end if;
  select * into assignee from app_users where id=p_task.assigned_to;
  return p_user.role='CEO'
    or (p_user.role='BOARD' and assignee.role='INTERN')
    or (p_user.role='FOUNDER' and assignee.role='INTERN' and p_task.assigned_by=p_user.id);
end; $$;

create or replace function round4_can_comment_task(p_user app_users, p_task tasks)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare assignee app_users;
begin
  if p_user.id is null or p_task.id is null then return false; end if;
  select * into assignee from app_users where id=p_task.assigned_to;
  return p_user.role='CEO'
    or (p_user.role='BOARD' and assignee.role='INTERN')
    or (p_user.role='FOUNDER' and (p_task.assigned_to=p_user.id or assignee.role='INTERN'))
    or (p_user.role='INTERN' and p_task.assigned_to=p_user.id);
end; $$;

create or replace function round4_notify(p_token text, p_actor_id uuid, p_user_id uuid, p_kind text, p_title text, p_body text, p_link_kind text, p_link_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_user_id is null or p_user_id = p_actor_id then return; end if;
  begin
    select create_notification_rpc(p_token,p_user_id,p_kind,p_title,coalesce(p_body,''),p_link_kind,p_link_id) into result;
    if coalesce((result->>'ok')::boolean,false) then return; end if;
  exception when undefined_function then
    null;
  end;

  if exists(select 1 from information_schema.tables where table_schema='public' and table_name='notifications') then
    insert into notifications(user_id, kind, title, body, link_kind, link_id, actor_id)
    values(p_user_id, p_kind, p_title, coalesce(p_body,''), p_link_kind, p_link_id, p_actor_id);
  end if;
end; $$;

create or replace function create_task_rpc(p_token text, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; new_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Task title is required'); end if;
  if not (me.role='CEO' or (me.role in ('BOARD','FOUNDER') and target_user.role='INTERN')) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed to assign this user');
  end if;

  insert into tasks(title, details, assigned_to, assigned_by, priority, due_date)
  values(trim(p_title),coalesce(p_details,''),p_assigned_to,me.id,p_priority,p_due_date)
  returning * into new_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'CREATE_TASK','tasks',new_task.id,jsonb_build_object('assigned_to',p_assigned_to));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_CREATED','task',new_task.id,new_task.id,'Task created',jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_ASSIGNED','task',new_task.id,new_task.id,'Task assigned',jsonb_build_object('assigned_to',p_assigned_to));

  perform round4_notify(p_token,me.id,p_assigned_to,'TASK_ASSIGNED','New task assigned',new_task.title,'task',new_task.id);

  return jsonb_build_object('ok',true,'data',round4_task_json(new_task),'error',null,'id',new_task.id);
end; $$;

create or replace function update_task_rpc(p_token text, p_task_id uuid, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; old_assigned_to uuid; target_user app_users; updated_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_manage_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Task title is required'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if not (me.role='CEO' or (me.role in ('BOARD','FOUNDER') and target_user.role='INTERN')) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed to assign this user');
  end if;

  old_assigned_to := task_row.assigned_to;

  update tasks
  set title=trim(p_title),
      details=coalesce(p_details,''),
      assigned_to=p_assigned_to,
      priority=p_priority,
      due_date=p_due_date
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_UPDATED','task',p_task_id,p_task_id,'Task updated',jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date));

  if old_assigned_to is distinct from p_assigned_to then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_ASSIGNED','task',p_task_id,p_task_id,'Task reassigned',jsonb_build_object('from',old_assigned_to,'to',p_assigned_to));
    perform round4_notify(p_token,me.id,p_assigned_to,'TASK_ASSIGNED','Task assigned to you',updated_task.title,'task',updated_task.id);
  end if;

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

create or replace function delete_task_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_manage_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'DELETE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',task_row.assigned_to));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_DELETED','task',p_task_id,null,'Task deleted',round4_task_json(task_row));

  delete from tasks where id=p_task_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',p_task_id),'error',null);
end; $$;

create or replace function get_task_by_id_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; comments_payload jsonb; proofs_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_view_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

  select jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'user_id',c.user_id,'user_name',u.name,'user_role',u.role,'body',c.body,'created_at',c.created_at) order by c.created_at asc)
  into comments_payload
  from task_comments c join app_users u on u.id=c.user_id
  where c.task_id=p_task_id;

  select jsonb_agg(jsonb_build_object('id',p.id,'task_id',p.task_id,'user_id',p.user_id,'user_name',u.name,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) order by p.created_at desc)
  into proofs_payload
  from proof_logs p join app_users u on u.id=p.user_id
  where p.task_id=p_task_id;

  return jsonb_build_object('ok',true,'data',round4_task_json(task_row) || jsonb_build_object('comments',coalesce(comments_payload,'[]'::jsonb),'proofs',coalesce(proofs_payload,'[]'::jsonb)),'error',null);
end; $$;

create or replace function update_task_status_rpc(p_token text, p_task_id uuid, p_status task_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; updated_task tasks; old_status task_status;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not (
    me.role='CEO'
    or round4_can_manage_task(me,task_row)
    or task_row.assigned_to=me.id
    or (me.role='FOUNDER' and round4_can_view_task(me,task_row))
  ) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed');
  end if;

  old_status := task_row.status;

  update tasks
  set status=p_status,
      completed_at=case when p_status='DONE' then coalesce(completed_at,now()) else completed_at end
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_STATUS','tasks',p_task_id,jsonb_build_object('from',old_status,'to',p_status));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'STATUS_CHANGED','task',p_task_id,p_task_id,'Task status changed',jsonb_build_object('from',old_status,'to',p_status));

  if p_status='DONE' and old_status is distinct from p_status then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_COMPLETED','task',p_task_id,p_task_id,'Task completed',jsonb_build_object('from',old_status,'to',p_status));
  end if;

  perform round4_notify(p_token,me.id,updated_task.assigned_to,'TASK_STATUS_CHANGED','Task status changed',updated_task.title || ' is now ' || p_status::text,'task',updated_task.id);
  perform round4_notify(p_token,me.id,updated_task.assigned_by,'TASK_STATUS_CHANGED',case when p_status='DONE' then 'Task completed' else 'Task status changed' end,updated_task.title || ' is now ' || p_status::text,'task',updated_task.id);

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

create or replace function add_task_comment_rpc(p_token text, p_task_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; new_comment task_comments; payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_comment_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  if length(trim(coalesce(p_body,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Comment is required'); end if;

  insert into task_comments(task_id,user_id,body)
  values(p_task_id,me.id,trim(p_body))
  returning * into new_comment;

  payload := jsonb_build_object('id',new_comment.id,'task_id',new_comment.task_id,'user_id',new_comment.user_id,'user_name',me.name,'user_role',me.role,'body',new_comment.body,'created_at',new_comment.created_at);

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'ADD_TASK_COMMENT','task_comments',new_comment.id,jsonb_build_object('task_id',p_task_id));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'COMMENT_ADDED','task_comment',new_comment.id,p_task_id,'Comment added',jsonb_build_object('task_id',p_task_id));

  perform round4_notify(p_token,me.id,task_row.assigned_to,'SYSTEM','New task comment',task_row.title,'task',p_task_id);
  perform round4_notify(p_token,me.id,task_row.assigned_by,'SYSTEM','New task comment',task_row.title,'task',p_task_id);

  return jsonb_build_object('ok',true,'data',payload,'error',null,'id',new_comment.id);
end; $$;

create or replace function get_task_comments_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_view_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

  select jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'user_id',c.user_id,'user_name',u.name,'user_role',u.role,'body',c.body,'created_at',c.created_at) order by c.created_at asc)
  into payload
  from task_comments c join app_users u on u.id=c.user_id
  where c.task_id=p_task_id;

  return jsonb_build_object('ok',true,'data',coalesce(payload,'[]'::jsonb),'error',null);
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
    if not round4_can_view_task(me,requested_task) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  end if;

  select jsonb_agg(row_to_json(x) order by x.created_at desc)
  into payload
  from (
    select e.id,e.actor_id,a.name actor_name,a.role actor_role,e.event_type,e.target_kind,e.target_id,e.task_id,e.body,e.meta,e.created_at
    from activity_events e
    left join app_users a on a.id=e.actor_id
    left join tasks t on t.id=e.task_id
    left join app_users assignee on assignee.id=t.assigned_to
    where (p_task_id is null or e.task_id=p_task_id)
      and (
        e.task_id is null and me.role in ('CEO','BOARD','FOUNDER')
        or me.role='CEO'
        or (me.role='BOARD' and assignee.role='INTERN')
        or (me.role='FOUNDER' and (t.assigned_to=me.id or assignee.role='INTERN'))
        or (me.role='INTERN' and t.assigned_to=me.id)
      )
    order by e.created_at desc
    limit safe_limit
  ) x;

  return jsonb_build_object('ok',true,'data',coalesce(payload,'[]'::jsonb),'error',null);
end; $$;

create or replace function add_log_rpc(p_token text, p_task_id uuid, p_note text, p_minutes int, p_screenshot_data_url text, p_is_submission boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; proof_id uuid;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if task_row.assigned_to <> me.id and me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','Only assignee can submit logs'); end if;

  if p_minutes > 0 then
    insert into time_logs(task_id,user_id,minutes,note) values(p_task_id,task_row.assigned_to,p_minutes,p_note);
  end if;

  insert into proof_logs(task_id,user_id,note,screenshot_data_url,is_submission)
  values(p_task_id,task_row.assigned_to,p_note,p_screenshot_data_url,p_is_submission)
  returning id into proof_id;

  if p_is_submission then
    update tasks set status='SUBMITTED' where id=p_task_id and status <> 'DONE';
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'PROOF_SUBMITTED','proof',proof_id,p_task_id,'Proof submitted',jsonb_build_object('minutes',p_minutes,'is_submission',p_is_submission));
    perform round4_notify(p_token,me.id,task_row.assigned_by,'PROOF_SUBMITTED','Proof submitted',task_row.title,'proof',proof_id);
  end if;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,case when p_is_submission then 'SUBMIT_WORK' else 'ADD_LOG' end,'proof_logs',proof_id,jsonb_build_object('task_id',p_task_id,'minutes',p_minutes));

  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',proof_id,'task_id',p_task_id),'error',null,'id',proof_id);
end; $$;

create or replace function apply_strikes()
returns void language plpgsql security definer set search_path=public as $$
declare struck record;
begin
  for struck in
    update tasks
    set strike_applied = true
    where due_date < current_date
      and status <> 'DONE'
      and coalesce(strike_applied,false) = false
    returning id, assigned_to, due_date, status
  loop
    update app_users set strikes = strikes + 1 where id = struck.assigned_to;
    insert into audit_logs(actor_id, action, target_table, target_id, meta)
    values(null, 'APPLY_STRIKE', 'tasks', struck.id, jsonb_build_object('assigned_to', struck.assigned_to, 'due_date', struck.due_date, 'status', struck.status));
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(null,'STRIKE_APPLIED','task',struck.id,struck.id,'Strike applied',jsonb_build_object('assigned_to',struck.assigned_to,'due_date',struck.due_date,'status',struck.status));
    if exists(select 1 from information_schema.tables where table_schema='public' and table_name='notifications') then
      insert into notifications(user_id,kind,title,body,link_kind,link_id,actor_id)
      values(struck.assigned_to,'STRIKE_APPLIED','Strike applied','A task passed its deadline.','task',struck.id,null);
    end if;
  end loop;
end; $$;

grant execute on function create_task_rpc(text, text, text, uuid, task_priority, date) to anon, authenticated;
grant execute on function update_task_rpc(text, uuid, text, text, uuid, task_priority, date) to anon, authenticated;
grant execute on function delete_task_rpc(text, uuid) to anon, authenticated;
grant execute on function get_task_by_id_rpc(text, uuid) to anon, authenticated;
grant execute on function update_task_status_rpc(text, uuid, task_status) to anon, authenticated;
grant execute on function add_task_comment_rpc(text, uuid, text) to anon, authenticated;
grant execute on function get_task_comments_rpc(text, uuid) to anon, authenticated;
grant execute on function get_activity_timeline_rpc(text, int, uuid) to anon, authenticated;
grant execute on function add_log_rpc(text, uuid, text, int, text, boolean) to anon, authenticated;

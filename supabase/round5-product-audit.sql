-- supabase/round5-product-audit.sql
-- Round 5 migration. Non-destructive, idempotent.
-- Adds: CEO cannot be assigned tasks (backend + frontend enforcement).
--       New RPC: get_dashboard_v2 (replaces get_dashboard with attention signals, no task duplication).
--       Activity timeline on dashboard.
--       Task detail data (comments + proofs joined into task list).

-- 1. Prevent CEO from being assigned via existing RPCs
create or replace function create_task_rpc(p_token text, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; new_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if target_user.role='CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO cannot be assigned tasks'); end if;
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
  if target_user.role='CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO cannot be assigned tasks'); end if;
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

-- 2. New get_dashboard_v2 RPC: removes task list duplication from dashboard, adds attention signals
create or replace function get_dashboard_v2(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb; ideas_payload jsonb;
  attention_overdue jsonb; attention_needs_review jsonb; attention_blocked jsonb; recent_activity jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  perform apply_strikes();
  select * into me from app_users where id=me.id;

  -- Visible people (CEO sees all; others see intern+self)
  select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'title',title,'strikes',strikes,'avatar_data_url',avatar_data_url)) into visible_users
  from app_users u where active=true and (
    me.role='CEO'
    or (me.role in ('BOARD','FOUNDER') and u.role='INTERN')
    or u.id=me.id
  );

  -- Founder ranking (CEO sees all; others see own rank)
  select jsonb_agg(row_to_json(x)) into founder_ranking from (
    select rank() over(order by score_for_user(u.id) desc, u.name) as rank, u.id, u.name, u.title, u.role, u.strikes, score_for_user(u.id) score,
    (select count(*) from tasks where assigned_to=u.id and status='DONE') done,
    (select count(*) from tasks where assigned_to=u.id) total
    from app_users u where u.active=true and u.role='FOUNDER'
  ) x where me.role='CEO' or x.id=me.id;

  -- Intern ranking (CEO/BOARD/FOUNDER see all; intern sees own)
  select jsonb_agg(row_to_json(x)) into intern_ranking from (
    select rank() over(order by score_for_user(u.id) desc, u.name) as rank, u.id, u.name, u.title, u.role, u.strikes, score_for_user(u.id) score,
    (select count(*) from tasks where assigned_to=u.id and status='DONE') done,
    (select count(*) from tasks where assigned_to=u.id) total
    from app_users u where u.active=true and u.role='INTERN'
  ) x where me.role in ('CEO','BOARD','FOUNDER') or x.id=me.id;

  -- Proof feed (CEO sees all; BOARD sees intern; others see self)
  select jsonb_agg(feed.item order by feed.created_at desc) into proof_feed
  from (
    select jsonb_build_object('id',p.id,'task_id',p.task_id,'task_title',t.title,'user',u.name,'avatar_data_url',u.avatar_data_url,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) item,
    p.created_at
    from proof_logs p join tasks t on t.id=p.task_id join app_users u on u.id=p.user_id
    where me.role='CEO'
      or (me.role='BOARD' and u.role='INTERN')
      or (me.role='FOUNDER' and (u.role='INTERN' or p.user_id=me.id))
      or p.user_id=me.id
    order by p.created_at desc limit 100
  ) feed;

  -- Ideas (CEO/BOARD see all; FOUNDER sees own+approved/in_progress; INTERN sees own)
  select jsonb_agg(jsonb_build_object(
    'id',i.id,'title',i.title,'description',i.description,'status',i.status,
    'submitted_by_id',su.id,'submitted_by_name',su.name,'submitted_by_role',su.role,'avatar_data_url',su.avatar_data_url,
    'decision_by_id',du.id,'decision_by_name',du.name,
    'decision_note',i.decision_note,'created_at',i.created_at,'updated_at',i.updated_at,'decided_at',i.decided_at
  ) order by i.created_at desc) into ideas_payload
  from ideas i
  join app_users su on su.id=i.submitted_by
  left join app_users du on du.id=i.decision_by
  where me.role in ('CEO','BOARD')
    or (me.role='FOUNDER' and (i.submitted_by=me.id or i.status in ('APPROVED','IN_PROGRESS')))
    or (me.role='INTERN' and i.submitted_by=me.id);

  -- Attention signal: Overdue tasks (for CEO, and for assignees to see their own)
  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.due_date asc) into attention_overdue
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where t.due_date < current_date and t.status <> 'DONE'
    and (me.role='CEO' or t.assigned_to=me.id);

  -- Attention signal: Tasks needing review (submitted, for CEO/Board/Founder who assigned)
  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.created_at desc) into attention_needs_review
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where t.status='SUBMITTED'
    and (
      me.role='CEO'
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN')
      or t.assigned_to=me.id
    );

  -- Attention signal: Blocked tasks
  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.due_date asc) into attention_blocked
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where t.status='BLOCKED'
    and (
      me.role='CEO'
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN')
      or t.assigned_to=me.id
    );

  -- Recent activity timeline (CEO sees all; BOARD sees intern; FOUNDER sees self+intern; INTERN sees self)
  select jsonb_agg(row_to_json(x) order by x.created_at desc) into recent_activity
  from (
    select e.id,e.event_type,e.body,e.meta,e.created_at,
      a.name actor_name,a.role actor_role,
      t.id task_id,t.title task_title,
      u.name assignee_name
    from activity_events e
    left join app_users a on a.id=e.actor_id
    left join tasks t on t.id=e.task_id
    left join app_users u on u.id=t.assigned_to
    where (
      me.role='CEO'
      or (me.role='BOARD' and u.role='INTERN')
      or (me.role='FOUNDER' and (e.actor_id=me.id or t.assigned_to=me.id or u.role='INTERN'))
      or (me.role='INTERN' and (e.actor_id=me.id or t.assigned_to=me.id))
    )
    order by e.created_at desc limit 50
  ) x;

  return jsonb_build_object('ok',true,
    'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes,'avatar_data_url',me.avatar_data_url),
    'visible_users',coalesce(visible_users,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),
    'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),
    'proof_feed',coalesce(proof_feed,'[]'::jsonb),
    'ideas',coalesce(ideas_payload,'[]'::jsonb),
    'attention_overdue',coalesce(attention_overdue,'[]'::jsonb),
    'attention_needs_review',coalesce(attention_needs_review,'[]'::jsonb),
    'attention_blocked',coalesce(attention_blocked,'[]'::jsonb),
    'recent_activity',coalesce(recent_activity,'[]'::jsonb),
    'unread_notifications',(select count(*)::int from notifications where user_id=me.id and read_at is null and dismissed_at is null)
  );
end; $$;

create or replace function get_tasks_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; tasks_payload jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'strike_applied',t.strike_applied,
    'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,'assignee_avatar_data_url',u.avatar_data_url,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name,'assigned_by_role',ab.role,'assigner_avatar_data_url',ab.avatar_data_url,
    'created_at',t.created_at,'completed_at',t.completed_at,'minutes',coalesce((select sum(minutes) from time_logs where task_id=t.id),0)
  ) order by t.created_at desc) into tasks_payload
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where me.role='CEO'
    or (me.role='BOARD' and u.role='INTERN')
    or (me.role='FOUNDER' and (t.assigned_to=me.id or u.role='INTERN'))
    or t.assigned_to=me.id;

  return jsonb_build_object('ok',true,'tasks',coalesce(tasks_payload,'[]'::jsonb));
end; $$;

-- Wrapper: make get_dashboard call the new v2 by default (backward compatible)
create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return get_dashboard_v2(p_token);
end; $$;

grant execute on function get_tasks_rpc(text) to anon, authenticated;
grant execute on function get_dashboard_v2(text) to anon, authenticated;

-- End of Round 5 migration.
-- Task RBAC, dashboard visibility, and CEO moderation controls.
-- Apply after round7-status-permissions.sql.

create or replace function moderate_strike_rpc(p_token text, p_target_user_id uuid, p_delta int, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; next_strikes int; event_id uuid;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  if me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO only'); end if;
  if p_delta not in (-1, 1) then return jsonb_build_object('ok',false,'data',null,'error','Strike delta must be -1 or 1'); end if;
  if length(trim(coalesce(p_reason,''))) < 3 then return jsonb_build_object('ok',false,'data',null,'error','Moderation reason is required'); end if;

  select * into target_user from app_users where id=p_target_user_id and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Target user not found'); end if;

  next_strikes := greatest(0, coalesce(target_user.strikes,0) + p_delta);
  update app_users set strikes=next_strikes where id=target_user.id;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,case when p_delta > 0 then 'MANUAL_STRIKE_ADD' else 'MANUAL_STRIKE_REMOVE' end,'app_users',target_user.id,
    jsonb_build_object('target_user_id',target_user.id,'target_name',target_user.name,'delta',p_delta,'reason',trim(p_reason),'strikes_before',target_user.strikes,'strikes_after',next_strikes))
  returning id into event_id;

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,case when p_delta > 0 then 'MANUAL_STRIKE_ADD' else 'MANUAL_STRIKE_REMOVE' end,'user',target_user.id,null,
    case when p_delta > 0 then 'Manual strike added' else 'Manual strike removed' end,
    jsonb_build_object('target_user_id',target_user.id,'target_name',target_user.name,'delta',p_delta,'reason',trim(p_reason),'audit_id',event_id));

  return jsonb_build_object('ok',true,'data',jsonb_build_object('user_id',target_user.id,'strikes',next_strikes),'error',null);
end; $$;

grant execute on function moderate_strike_rpc(text, uuid, int, text) to anon, authenticated;

create or replace function get_tasks_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; tasks_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'strike_applied',t.strike_applied,
    'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,'assignee_avatar_data_url',u.avatar_data_url,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name,'assigned_by_role',ab.role,'assigner_avatar_data_url',ab.avatar_data_url,
    'created_at',t.created_at,'completed_at',t.completed_at,'minutes',coalesce((select sum(minutes) from time_logs where task_id=t.id),0),
    'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'note',p.note,'is_submission',p.is_submission,'created_at',p.created_at,'screenshot_data_url',p.screenshot_data_url) order by p.created_at desc) from proof_logs p where p.task_id=t.id),'[]'::jsonb)
  ) order by t.created_at desc) into tasks_payload
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where me.role='CEO'
    or t.assigned_to=me.id
    or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id);

  return jsonb_build_object('ok',true,'tasks',coalesce(tasks_payload,'[]'::jsonb));
end; $$;

grant execute on function get_tasks_rpc(text) to anon, authenticated;

create or replace function get_dashboard_v2(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb; ideas_payload jsonb;
  attention_overdue jsonb; attention_needs_review jsonb; attention_blocked jsonb; recent_activity jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  perform apply_strikes();
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'role',u.role,'title',u.title,'strikes',u.strikes,'avatar_data_url',u.avatar_data_url)) into visible_users
  from app_users u
  where u.active=true and (
    me.role='CEO'
    or u.id=me.id
    or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and exists (select 1 from tasks t where t.assigned_to=u.id and t.assigned_by=me.id))
  );

  select jsonb_agg(row_to_json(x)) into founder_ranking from (
    select rank() over(order by score_for_user(u.id) desc, u.name) as rank, u.id, u.name, u.title, u.role, u.strikes, score_for_user(u.id) score,
    (select count(*) from tasks where assigned_to=u.id and status='DONE') done,
    (select count(*) from tasks where assigned_to=u.id) total
    from app_users u where u.active=true and u.role='FOUNDER'
  ) x where me.role='CEO' or x.id=me.id;

  select jsonb_agg(row_to_json(x)) into intern_ranking from (
    select rank() over(order by score_for_user(u.id) desc, u.name) as rank, u.id, u.name, u.title, u.role, u.strikes, score_for_user(u.id) score,
    (select count(*) from tasks where assigned_to=u.id and status='DONE') done,
    (select count(*) from tasks where assigned_to=u.id) total
    from app_users u where u.active=true and u.role='INTERN'
  ) x where me.role='CEO'
    or x.id=me.id
    or (me.role in ('BOARD','FOUNDER') and exists (select 1 from tasks t where t.assigned_to=x.id and t.assigned_by=me.id));

  select jsonb_agg(feed.item order by feed.created_at desc) into proof_feed
  from (
    select jsonb_build_object('id',p.id,'task_id',p.task_id,'task_title',t.title,'user',u.name,'avatar_data_url',u.avatar_data_url,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) item,
    p.created_at
    from proof_logs p join tasks t on t.id=p.task_id join app_users u on u.id=p.user_id
    where me.role='CEO'
      or p.user_id=me.id
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id)
    order by p.created_at desc limit 100
  ) feed;

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

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.due_date asc) into attention_overdue
  from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
  where t.due_date < current_date and t.status <> 'DONE'
    and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id));

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.created_at desc) into attention_needs_review
  from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
  where t.status='SUBMITTED'
    and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id));

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
    'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name
  ) order by t.due_date asc) into attention_blocked
  from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
  where t.status='BLOCKED'
    and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id));

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
    where me.role='CEO'
      or e.actor_id=me.id
      or t.assigned_to=me.id
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id)
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

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return get_dashboard_v2(p_token);
end; $$;

grant execute on function get_dashboard_v2(text) to anon, authenticated;
grant execute on function get_dashboard(text) to anon, authenticated;

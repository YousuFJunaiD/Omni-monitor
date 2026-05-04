-- supabase/round3-profile-notifications.sql
-- Round 3 migration. Non-destructive, idempotent.
-- Adds: avatar_data_url column on app_users; notifications table and RPCs;
--       update_avatar_rpc; get_person_profile RPC.
-- Modifies: get_dashboard (preserves all existing keys, adds avatar_data_url to me/visible_users/proof_feed/ideas/tasks).
-- Does not modify: any other existing function, any existing table beyond the avatar column.

alter table app_users add column if not exists avatar_data_url text;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in (
    'TASK_ASSIGNED','TASK_STATUS_CHANGED','PROOF_SUBMITTED',
    'IDEA_SUBMITTED','IDEA_STATUS_CHANGED',
    'STRIKE_APPLIED','SYSTEM'
  )),
  title text not null,
  body text not null default '',
  link_kind text,
  link_id uuid,
  actor_id uuid references app_users(id) on delete set null,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on notifications(user_id, created_at desc) where dismissed_at is null;

alter table notifications enable row level security;

create or replace function update_avatar_rpc(p_token text, p_avatar_data_url text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  if p_avatar_data_url is null or p_avatar_data_url = '' then
    update app_users set avatar_data_url = null where id = me.id;
    insert into audit_logs(actor_id,action,target_table,target_id,meta)
    values(me.id,'UPDATE_AVATAR','app_users',me.id,jsonb_build_object('cleared',true));
    return jsonb_build_object('ok',true,'cleared',true);
  end if;

  if p_avatar_data_url not like 'data:image/%' then
    return jsonb_build_object('ok',false,'error','Invalid image format');
  end if;

  if length(p_avatar_data_url) > 280000 then
    return jsonb_build_object('ok',false,'error','Avatar too large (max 200KB)');
  end if;

  update app_users set avatar_data_url = p_avatar_data_url where id = me.id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_AVATAR','app_users',me.id,jsonb_build_object('size',length(p_avatar_data_url)));
  return jsonb_build_object('ok',true);
end; $$;

create or replace function create_notification_rpc(p_token text, p_user_id uuid, p_kind text, p_title text, p_body text, p_link_kind text, p_link_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; new_id uuid;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  if not (me.role in ('CEO','BOARD','FOUNDER') or p_user_id = me.id) then
    return jsonb_build_object('ok',false,'error','Not allowed');
  end if;

  if p_kind not in ('TASK_ASSIGNED','TASK_STATUS_CHANGED','PROOF_SUBMITTED','IDEA_SUBMITTED','IDEA_STATUS_CHANGED','STRIKE_APPLIED','SYSTEM') then
    return jsonb_build_object('ok',false,'error','Invalid notification kind');
  end if;

  if length(trim(coalesce(p_title,''))) < 1 then
    return jsonb_build_object('ok',false,'error','Title required');
  end if;

  if length(trim(p_title)) > 200 then
    return jsonb_build_object('ok',false,'error','Title too long');
  end if;

  insert into notifications(user_id, kind, title, body, link_kind, link_id, actor_id)
  values(p_user_id, p_kind, trim(p_title), coalesce(p_body,''), p_link_kind, p_link_id, me.id)
  returning id into new_id;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'CREATE_NOTIFICATION','notifications',new_id,jsonb_build_object('user_id',p_user_id,'kind',p_kind,'link_kind',p_link_kind,'link_id',p_link_id));
  return jsonb_build_object('ok',true,'id',new_id);
end; $$;

create or replace function mark_notification_read_rpc(p_token text, p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; n notifications;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into n from notifications where id = p_notification_id;
  if n.id is null or n.user_id <> me.id then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  update notifications set read_at = coalesce(read_at, now()) where id = p_notification_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'MARK_NOTIFICATION_READ','notifications',p_notification_id,'{}'::jsonb);
  return jsonb_build_object('ok',true);
end; $$;

create or replace function mark_all_notifications_read_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; updated_count int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  update notifications
  set read_at = now()
  where user_id = me.id and read_at is null and dismissed_at is null;
  get diagnostics updated_count = row_count;

  insert into audit_logs(actor_id,action,target_table,meta)
  values(me.id,'MARK_ALL_NOTIFICATIONS_READ','notifications',jsonb_build_object('count',updated_count));
  return jsonb_build_object('ok',true,'count',updated_count);
end; $$;

create or replace function dismiss_notification_rpc(p_token text, p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; n notifications;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into n from notifications where id = p_notification_id;
  if n.id is null or n.user_id <> me.id then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  update notifications set dismissed_at = coalesce(dismissed_at, now()) where id = p_notification_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'DISMISS_NOTIFICATION','notifications',p_notification_id,'{}'::jsonb);
  return jsonb_build_object('ok',true);
end; $$;

create or replace function get_person_profile(p_token text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; tasks_payload jsonb; ideas_payload jsonb; proofs_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into target_user from app_users where id = p_user_id and active = true;
  if target_user.id is null then return jsonb_build_object('ok',false,'error','User not found'); end if;

  if not (
    me.role in ('CEO','BOARD')
    or (me.role='FOUNDER' and (target_user.id=me.id or target_user.role in ('CEO','BOARD','FOUNDER','INTERN')))
    or (me.role='INTERN' and (target_user.id=me.id or target_user.role in ('CEO','BOARD','FOUNDER')))
  ) then
    return jsonb_build_object('ok',false,'error','Not allowed');
  end if;

  select jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'status',x.status,'priority',x.priority,'due_date',x.due_date,'created_at',x.created_at,'assigned_by_name',x.assigned_by_name
  ) order by x.created_at desc) into tasks_payload
  from (
    select t.id,t.title,t.status,t.priority,t.due_date,t.created_at,ab.name assigned_by_name
    from tasks t
    left join app_users ab on ab.id=t.assigned_by
    where t.assigned_to = target_user.id
    order by t.created_at desc
    limit 50
  ) x;

  select jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'status',x.status,'created_at',x.created_at
  ) order by x.created_at desc) into ideas_payload
  from (
    select i.id,i.title,i.status,i.created_at
    from ideas i
    where i.submitted_by = target_user.id
    order by i.created_at desc
    limit 50
  ) x;

  select jsonb_agg(jsonb_build_object(
    'id',x.id,'task_title',x.task_title,'note',x.note,'is_submission',x.is_submission,'created_at',x.created_at
  ) order by x.created_at desc) into proofs_payload
  from (
    select p.id,t.title task_title,p.note,p.is_submission,p.created_at
    from proof_logs p
    join tasks t on t.id=p.task_id
    where p.user_id = target_user.id
    order by p.created_at desc
    limit 20
  ) x;

  return jsonb_build_object(
    'ok',true,
    'user',jsonb_build_object(
      'id',target_user.id,'name',target_user.name,'username',target_user.username,
      'role',target_user.role,'title',target_user.title,'strikes',target_user.strikes,
      'avatar_data_url',target_user.avatar_data_url,
      'score',score_for_user(target_user.id),
      'joined_at',target_user.created_at
    ),
    'tasks',coalesce(tasks_payload,'[]'::jsonb),
    'ideas',coalesce(ideas_payload,'[]'::jsonb),
    'recent_proofs',coalesce(proofs_payload,'[]'::jsonb)
  );
end; $$;

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; visible_tasks jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb; ideas_payload jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  perform apply_strikes();
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'title',title,'strikes',strikes,'avatar_data_url',u.avatar_data_url)) into visible_users
  from app_users u where active=true and (
    me.role='CEO'
    or (me.role in ('BOARD','FOUNDER') and u.role='INTERN')
    or u.id=me.id
  );

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'strike_applied',t.strike_applied,
    'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,'assignee_avatar_data_url',u.avatar_data_url,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name,'assigned_by_role',ab.role,'assigner_avatar_data_url',ab.avatar_data_url,
    'created_at',t.created_at,'completed_at',t.completed_at,'minutes',coalesce((select sum(minutes) from time_logs where task_id=t.id),0)
  )) into visible_tasks
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where me.role='CEO'
    or (me.role='BOARD' and u.role='INTERN')
    or (me.role='FOUNDER' and (t.assigned_to=me.id or u.role='INTERN'))
    or t.assigned_to=me.id;

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
  ) x where me.role in ('CEO','BOARD','FOUNDER') or x.id=me.id;

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

  return jsonb_build_object('ok',true,'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes,'avatar_data_url',me.avatar_data_url),
    'visible_users',coalesce(visible_users,'[]'::jsonb),'tasks',coalesce(visible_tasks,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'proof_feed',coalesce(proof_feed,'[]'::jsonb),
    'ideas',coalesce(ideas_payload,'[]'::jsonb),
    'unread_notifications',(select count(*)::int from notifications where user_id = me.id and read_at is null and dismissed_at is null));
end; $$;

create or replace function get_notifications(p_token text, p_limit int default 30, p_include_read boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; items jsonb; unread_count int; safe_limit int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  safe_limit := least(greatest(coalesce(p_limit,30),1),100);

  select jsonb_agg(row_to_json(x) order by x.created_at desc) into items
  from (
    select n.id,n.kind,n.title,n.body,n.link_kind,n.link_id,n.actor_id,actor.name actor_name,actor.avatar_data_url actor_avatar_data_url,n.read_at,n.created_at
    from notifications n
    left join app_users actor on actor.id = n.actor_id
    where n.user_id = me.id
      and n.dismissed_at is null
      and (p_include_read = true or n.read_at is null)
    order by n.created_at desc
    limit safe_limit
  ) x;

  select count(*)::int into unread_count
  from notifications
  where user_id = me.id and read_at is null and dismissed_at is null;

  return jsonb_build_object('ok',true,'items',coalesce(items,'[]'::jsonb),'unread_count',unread_count);
end; $$;

grant execute on function update_avatar_rpc(text, text) to anon, authenticated;
grant execute on function create_notification_rpc(text, uuid, text, text, text, text, uuid) to anon, authenticated;
grant execute on function mark_notification_read_rpc(text, uuid) to anon, authenticated;
grant execute on function mark_all_notifications_read_rpc(text) to anon, authenticated;
grant execute on function dismiss_notification_rpc(text, uuid) to anon, authenticated;
grant execute on function get_person_profile(text, uuid) to anon, authenticated;
grant execute on function get_notifications(text, int, boolean) to anon, authenticated;
grant execute on function get_dashboard(text) to anon, authenticated;

-- End of Round 3 migration.

-- Non-destructive migration for Founder -> Intern task/proof visibility.
-- Run before supabase/idea-board.sql if applying both migrations.

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; visible_tasks jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  perform apply_strikes();
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'title',title,'strikes',strikes)) into visible_users
  from app_users u where active=true and (
    me.role='CEO'
    or (me.role in ('BOARD','FOUNDER') and u.role='INTERN')
    or u.id=me.id
  );

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'strike_applied',t.strike_applied,
    'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name,'assigned_by_role',ab.role,
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
    select jsonb_build_object('id',p.id,'task_id',p.task_id,'task_title',t.title,'user',u.name,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) item,
    p.created_at
    from proof_logs p join tasks t on t.id=p.task_id join app_users u on u.id=p.user_id
    where me.role='CEO'
      or (me.role='BOARD' and u.role='INTERN')
      or (me.role='FOUNDER' and (u.role='INTERN' or p.user_id=me.id))
      or p.user_id=me.id
    order by p.created_at desc limit 100
  ) feed;

  return jsonb_build_object('ok',true,'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes),
    'visible_users',coalesce(visible_users,'[]'::jsonb),'tasks',coalesce(visible_tasks,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'proof_feed',coalesce(proof_feed,'[]'::jsonb),
    'ideas','[]'::jsonb);
end; $$;

create or replace function create_task_rpc(p_token text, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target app_users; new_id uuid;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into target from app_users where id=p_assigned_to and active=true;
  if target.id is null then return jsonb_build_object('ok',false,'error','Invalid assignee'); end if;
  if not (me.role='CEO' or (me.role in ('BOARD','FOUNDER') and target.role='INTERN')) then return jsonb_build_object('ok',false,'error','Not allowed to assign this user'); end if;
  insert into tasks(title, details, assigned_to, assigned_by, priority, due_date) values(p_title,p_details,p_assigned_to,me.id,p_priority,p_due_date) returning id into new_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,'CREATE_TASK','tasks',new_id,jsonb_build_object('assigned_to',p_assigned_to));
  return jsonb_build_object('ok',true,'id',new_id);
end; $$;

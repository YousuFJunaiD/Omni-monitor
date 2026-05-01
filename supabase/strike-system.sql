-- Non-destructive strike-system migration for an existing Supabase project.
-- Run this in Supabase SQL Editor if you do not want to rerun schema.sql.

alter table app_users add column if not exists strikes int default 0;
update app_users set strikes = 0 where strikes is null;
alter table app_users alter column strikes set not null;

alter table tasks add column if not exists strike_applied boolean not null default false;

create or replace function apply_strikes()
returns void language plpgsql security definer set search_path=public as $$
begin
  with newly_overdue as (
    update tasks
    set strike_applied = true
    where due_date < current_date
      and status != 'DONE'
      and strike_applied = false
    returning assigned_to
  ),
  strike_counts as (
    select assigned_to, count(*)::int as strike_count
    from newly_overdue
    group by assigned_to
  )
  update app_users u
  set strikes = u.strikes + sc.strike_count
  from strike_counts sc
  where sc.assigned_to = u.id;
end;
$$;

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; visible_tasks jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  perform apply_strikes();
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object('id',id,'name',name,'username',username,'role',role,'title',title,'strikes',strikes)) into visible_users
  from app_users u where active=true and (
    me.role='CEO' or (me.role='BOARD' and u.role='INTERN') or u.id=me.id
  );

  select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,'created_at',t.created_at,'completed_at',t.completed_at,'minutes',coalesce((select sum(minutes) from time_logs where task_id=t.id),0))) into visible_tasks
  from tasks t join app_users u on u.id=t.assigned_to
  where me.role='CEO' or (me.role='BOARD' and u.role='INTERN') or t.assigned_to=me.id;

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
    where me.role='CEO' or (me.role='BOARD' and u.role='INTERN') or p.user_id=me.id
    order by p.created_at desc limit 100
  ) feed;

  return jsonb_build_object('ok',true,'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes),
    'visible_users',coalesce(visible_users,'[]'::jsonb),'tasks',coalesce(visible_tasks,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'proof_feed',coalesce(proof_feed,'[]'::jsonb));
end; $$;

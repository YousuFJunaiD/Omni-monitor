-- Non-destructive Idea Board migration.
-- Run after supabase/founder-intern-management.sql when applying both migrations.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'idea_status') then
    create type idea_status as enum ('PENDING','UNDER_REVIEW','APPROVED','IN_PROGRESS','REJECTED');
  end if;
end $$;

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  submitted_by uuid not null references app_users(id) on delete cascade,
  status idea_status not null default 'PENDING',
  decision_by uuid references app_users(id),
  decision_note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table ideas enable row level security;

create or replace function submit_idea_rpc(p_token text, p_title text, p_description text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; new_id uuid;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if length(trim(coalesce(p_title,''))) < 3 then return jsonb_build_object('ok',false,'error','Idea title is required'); end if;
  if length(trim(coalesce(p_description,''))) < 5 then return jsonb_build_object('ok',false,'error','Idea description is required'); end if;

  insert into ideas(title, description, submitted_by)
  values(trim(p_title), trim(p_description), me.id)
  returning id into new_id;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'SUBMIT_IDEA','ideas',new_id,jsonb_build_object('status','PENDING'));
  return jsonb_build_object('ok',true,'id',new_id);
end; $$;

create or replace function update_idea_status_rpc(p_token text, p_idea_id uuid, p_status idea_status, p_decision_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; idea_row ideas; submitter app_users;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into idea_row from ideas where id=p_idea_id;
  if idea_row.id is null then return jsonb_build_object('ok',false,'error','Idea not found'); end if;
  select * into submitter from app_users where id=idea_row.submitted_by;

  if not (
    me.role='CEO'
    or (me.role='BOARD' and submitter.role='INTERN')
  ) then
    return jsonb_build_object('ok',false,'error','Not allowed to decide this idea');
  end if;

  update ideas
  set status=p_status,
      decision_by=me.id,
      decision_note=coalesce(p_decision_note,''),
      updated_at=now(),
      decided_at=now()
  where id=p_idea_id;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_IDEA_STATUS','ideas',p_idea_id,jsonb_build_object('status',p_status,'submitted_by',idea_row.submitted_by));
  return jsonb_build_object('ok',true);
end; $$;

create or replace function delete_idea_rpc(p_token text, p_idea_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; idea_row ideas;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into idea_row from ideas where id=p_idea_id;
  if idea_row.id is null then return jsonb_build_object('ok',false,'error','Idea not found'); end if;

  if not (me.role='CEO' or (idea_row.submitted_by=me.id and idea_row.status='PENDING')) then
    return jsonb_build_object('ok',false,'error','Only the submitter can delete pending ideas, or CEO can delete anytime');
  end if;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'DELETE_IDEA','ideas',p_idea_id,jsonb_build_object('submitted_by',idea_row.submitted_by,'status',idea_row.status));
  delete from ideas where id=p_idea_id;
  return jsonb_build_object('ok',true);
end; $$;

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; visible_tasks jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb; ideas_payload jsonb;
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

  select jsonb_agg(jsonb_build_object(
    'id',i.id,'title',i.title,'description',i.description,'status',i.status,
    'submitted_by_id',su.id,'submitted_by_name',su.name,'submitted_by_role',su.role,
    'decision_by_id',du.id,'decision_by_name',du.name,
    'decision_note',i.decision_note,'created_at',i.created_at,'updated_at',i.updated_at,'decided_at',i.decided_at
  ) order by i.created_at desc) into ideas_payload
  from ideas i
  join app_users su on su.id=i.submitted_by
  left join app_users du on du.id=i.decision_by
  where me.role in ('CEO','BOARD')
    or (me.role='FOUNDER' and (i.submitted_by=me.id or i.status in ('APPROVED','IN_PROGRESS')))
    or (me.role='INTERN' and i.submitted_by=me.id);

  return jsonb_build_object('ok',true,'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes),
    'visible_users',coalesce(visible_users,'[]'::jsonb),'tasks',coalesce(visible_tasks,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'proof_feed',coalesce(proof_feed,'[]'::jsonb),
    'ideas',coalesce(ideas_payload,'[]'::jsonb));
end; $$;

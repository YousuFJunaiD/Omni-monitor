-- Omnimate Monitor: username/password + RBAC + reports
-- Run this whole file in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- reset schema objects so this file can be run cleanly again
drop table if exists audit_logs cascade;
drop table if exists proof_logs cascade;
drop table if exists time_logs cascade;
drop table if exists tasks cascade;
drop table if exists app_sessions cascade;
drop table if exists app_users cascade;

drop type if exists task_priority cascade;
drop type if exists task_status cascade;
drop type if exists app_role cascade;

create type app_role as enum ('CEO','BOARD','FOUNDER','INTERN');
create type task_status as enum ('TODO','IN_PROGRESS','SUBMITTED','DONE','BLOCKED');
create type task_priority as enum ('LOW','MEDIUM','HIGH','URGENT');

create table app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text unique not null check (username ~ '^[a-z0-9_]{3,40}$'),
  password_hash text not null,
  role app_role not null,
  title text not null,
  strikes int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table app_sessions (
  token text primary key default encode(gen_random_bytes(32), 'hex'),
  user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text default '',
  assigned_to uuid not null references app_users(id),
  assigned_by uuid references app_users(id),
  priority task_priority not null default 'MEDIUM',
  status task_status not null default 'TODO',
  due_date date,
  strike_applied boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  minutes int not null default 0 check (minutes >= 0 and minutes <= 1440),
  note text default '',
  created_at timestamptz not null default now()
);

create table proof_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  note text default '',
  screenshot_data_url text,
  is_submission boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid references app_users(id),
  action text not null,
  target_table text,
  target_id uuid,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table tasks enable row level security;
alter table time_logs enable row level security;
alter table proof_logs enable row level security;
alter table audit_logs enable row level security;

-- No table policies. Frontend uses RPC only. This prevents browsing tables with anon key.

insert into app_users(name, username, password_hash, role, title) values
('Mohammed Yousuf Junaid','yusuf_ceo', crypt(gen_random_uuid()::text, gen_salt('bf')), 'CEO','CEO'),
('Mohammed Ainan','ainan_cto', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CTO'),
('Umme Hani Khanam','umme_cpo', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CPO'),
('Faris Ruknuddin','faris_csa', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CSA'),
('Rawahah Ruknuddin','rawahah_cxo', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CXO'),
('Mohammed Samaan','samaan_cma', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CMA'),
('Ibrahim Abdullah','ibrahim_cmo', crypt(gen_random_uuid()::text, gen_salt('bf')), 'FOUNDER','CMO'),
('Qatadah Ruknuddin','qatadah_sales', crypt(gen_random_uuid()::text, gen_salt('bf')), 'INTERN','Marketing and Sales Intern');

create or replace function private_user_from_token(p_token text)
returns app_users language sql security definer set search_path=public as $$
  select u.* from app_sessions s join app_users u on u.id=s.user_id
  where s.token=p_token and s.expires_at > now() and u.active = true limit 1;
$$;

create or replace function login_user(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u app_users; t text;
begin
  select * into u from app_users where username=lower(trim(p_username)) and active=true;
  if u.id is null or u.password_hash <> crypt(p_password, u.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'Invalid username or password');
  end if;
  insert into app_sessions(user_id) values(u.id) returning token into t;
  insert into audit_logs(actor_id, action, meta) values(u.id, 'LOGIN', jsonb_build_object('username', u.username));
  return jsonb_build_object('ok', true, 'token', t, 'user', jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'role',u.role,'title',u.title));
end; $$;

create or replace function logout_user(p_token text)
returns boolean language plpgsql security definer set search_path=public as $$
begin delete from app_sessions where token=p_token; return true; end; $$;

create or replace function score_for_user(p_user uuid)
returns int language sql security definer set search_path=public as $$
  select coalesce(sum(case when t.status='DONE' then 60 when t.status='SUBMITTED' then 35 when t.status='IN_PROGRESS' then 10 else 0 end),0)::int
       + coalesce((select sum(minutes)/10 from time_logs where user_id=p_user),0)::int
       + coalesce((select count(*)*15 from proof_logs where user_id=p_user and is_submission=true),0)::int
  from tasks t where t.assigned_to=p_user;
$$;

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

create or replace function create_task_rpc(p_token text, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target app_users; new_id uuid;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into target from app_users where id=p_assigned_to and active=true;
  if target.id is null then return jsonb_build_object('ok',false,'error','Invalid assignee'); end if;
  if not (me.role='CEO' or (me.role='BOARD' and target.role='INTERN')) then return jsonb_build_object('ok',false,'error','Not allowed to assign this user'); end if;
  insert into tasks(title, details, assigned_to, assigned_by, priority, due_date) values(p_title,p_details,p_assigned_to,me.id,p_priority,p_due_date) returning id into new_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,'CREATE_TASK','tasks',new_id,jsonb_build_object('assigned_to',p_assigned_to));
  return jsonb_build_object('ok',true,'id',new_id);
end; $$;

create or replace function update_task_status_rpc(p_token text, p_task_id uuid, p_status task_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; assignee app_users;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id; select * into assignee from app_users where id=task_row.assigned_to;
  if task_row.id is null then return jsonb_build_object('ok',false,'error','Task not found'); end if;
  if not (me.role='CEO' or task_row.assigned_to=me.id or (me.role='BOARD' and assignee.role='INTERN')) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;
  update tasks set status=p_status, completed_at=case when p_status='DONE' then now() else completed_at end where id=p_task_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,'UPDATE_STATUS','tasks',p_task_id,jsonb_build_object('status',p_status));
  return jsonb_build_object('ok',true);
end; $$;

create or replace function delete_task_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; assignee app_users;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id; if task_row.id is null then return jsonb_build_object('ok',false,'error','Task not found'); end if;
  select * into assignee from app_users where id=task_row.assigned_to;
  if not (me.role='CEO' or (me.role='BOARD' and assignee.role='INTERN')) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;
  delete from tasks where id=p_task_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,'DELETE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',task_row.assigned_to));
  return jsonb_build_object('ok',true);
end; $$;

create or replace function add_log_rpc(p_token text, p_task_id uuid, p_note text, p_minutes int, p_screenshot_data_url text, p_is_submission boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; proof_id uuid;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id; if task_row.id is null then return jsonb_build_object('ok',false,'error','Task not found'); end if;
  if task_row.assigned_to <> me.id and me.role <> 'CEO' then return jsonb_build_object('ok',false,'error','Only assignee can submit logs'); end if;
  if p_minutes > 0 then insert into time_logs(task_id,user_id,minutes,note) values(p_task_id,task_row.assigned_to,p_minutes,p_note); end if;
  insert into proof_logs(task_id,user_id,note,screenshot_data_url,is_submission) values(p_task_id,task_row.assigned_to,p_note,p_screenshot_data_url,p_is_submission) returning id into proof_id;
  if p_is_submission then update tasks set status='SUBMITTED' where id=p_task_id and status <> 'DONE'; end if;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,case when p_is_submission then 'SUBMIT_WORK' else 'ADD_LOG' end,'proof_logs',proof_id,jsonb_build_object('task_id',p_task_id,'minutes',p_minutes));
  return jsonb_build_object('ok',true,'id',proof_id);
end; $$;

create or replace function get_report_rpc(p_token text, p_period text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; start_at timestamptz; payload jsonb;
begin
  select * into me from private_user_from_token(p_token); if me.id is null or me.role <> 'CEO' then return jsonb_build_object('ok',false,'error','CEO only'); end if;
  start_at := case when p_period='monthly' then date_trunc('month',now()) else date_trunc('week',now()) end;
  select jsonb_agg(row_to_json(x)) into payload from (
    select u.name,u.title,u.role, score_for_user(u.id) score,
    (select count(*) from tasks where assigned_to=u.id and created_at>=start_at) tasks_assigned,
    (select count(*) from tasks where assigned_to=u.id and status='DONE' and completed_at>=start_at) completed,
    (select coalesce(sum(minutes),0) from time_logs where user_id=u.id and created_at>=start_at) minutes,
    (select count(*) from proof_logs where user_id=u.id and created_at>=start_at) proof_count
    from app_users u where u.active=true and u.role in ('FOUNDER','INTERN') order by u.role, score desc
  ) x;
  return jsonb_build_object('ok',true,'period',p_period,'generated_at',now(),'best_founder',(select row_to_json(b) from (select name,title,score_for_user(id) score from app_users where role='FOUNDER' order by score_for_user(id) desc limit 1)b),'best_intern',(select row_to_json(b) from (select name,title,score_for_user(id) score from app_users where role='INTERN' order by score_for_user(id) desc limit 1)b),'rows',coalesce(payload,'[]'::jsonb));
end; $$;

-- Example starter tasks
insert into tasks(title,details,assigned_to,assigned_by,priority,due_date)
select 'Technical roadmap for monitor dashboard','Prepare architecture and implementation notes for Omnimate internal systems.', u.id, (select id from app_users where username='yusuf_ceo'),'HIGH', current_date+3 from app_users u where username='ainan_cto';
insert into tasks(title,details,assigned_to,assigned_by,priority,due_date)
select 'Lead list for schools','Prepare verified school leads with contact proof screenshots.', u.id, (select id from app_users where username='yusuf_ceo'),'HIGH', current_date+2 from app_users u where username='qatadah_sales';

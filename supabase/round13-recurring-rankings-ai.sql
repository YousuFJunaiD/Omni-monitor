-- Recurring tasks, richer rankings, and AI analysis storage scaffolding.
-- Additive and safe: existing task creation/RBAC/proof flows remain unchanged.

create table if not exists recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text default '',
  assigned_to uuid not null references app_users(id),
  assigned_by uuid not null references app_users(id),
  priority task_priority not null default 'MEDIUM',
  recurrence_type text not null check (recurrence_type in ('DAILY','WEEKLY_DAYS')),
  recurrence_days int[] default '{}',
  start_date date not null,
  end_date date,
  deadline_time time,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists recurring_task_instances (
  id uuid primary key default gen_random_uuid(),
  recurring_task_id uuid not null references recurring_tasks(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  run_date date not null,
  created_at timestamptz not null default now(),
  unique(recurring_task_id, run_date)
);

create table if not exists ai_work_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  generated_by uuid references app_users(id),
  period text not null default 'recent',
  note text not null,
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  generated_by uuid references app_users(id),
  report_json jsonb not null default '{}'::jsonb,
  ai_summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_recurring_tasks_active_dates on recurring_tasks(active, start_date, end_date);
create index if not exists idx_recurring_task_instances_template_date on recurring_task_instances(recurring_task_id, run_date);
create index if not exists idx_ai_work_notes_user_created on ai_work_notes(user_id, created_at desc);
create index if not exists idx_ai_reports_period_created on ai_reports(period, created_at desc);
create index if not exists idx_tasks_assigned_to_status_due on tasks(assigned_to, status, due_date);
create index if not exists idx_tasks_completed_at on tasks(completed_at);
create index if not exists idx_proof_logs_user_created on proof_logs(user_id, created_at desc);
create index if not exists idx_activity_events_actor_created on activity_events(actor_id, created_at desc);

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

create or replace function can_view_user_summary(p_viewer app_users, p_target app_users)
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

create or replace function create_recurring_task_rpc(
  p_token text,
  p_title text,
  p_details text,
  p_assigned_to uuid,
  p_priority task_priority,
  p_recurrence_type text,
  p_recurrence_days int[],
  p_start_date date,
  p_end_date date default null,
  p_deadline_time time default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  target_user app_users;
  template recurring_tasks;
  run_day date;
  final_day date;
  created_count int := 0;
  new_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'error','Invalid assignee'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'error','Task title is required'); end if;
  if not can_assign_department_task(me, target_user) then return jsonb_build_object('ok',false,'error','Not allowed to assign this user'); end if;
  if p_start_date is null then return jsonb_build_object('ok',false,'error','Start date is required'); end if;
  if p_recurrence_type not in ('DAILY','WEEKLY_DAYS') then return jsonb_build_object('ok',false,'error','Invalid recurrence'); end if;
  if p_recurrence_type = 'WEEKLY_DAYS' and coalesce(array_length(p_recurrence_days,1),0) = 0 then
    return jsonb_build_object('ok',false,'error','Choose at least one day');
  end if;

  final_day := least(coalesce(p_end_date, p_start_date + 30), p_start_date + 180);
  if final_day < p_start_date then return jsonb_build_object('ok',false,'error','End date must be after start date'); end if;

  insert into recurring_tasks(title, details, assigned_to, assigned_by, priority, recurrence_type, recurrence_days, start_date, end_date, deadline_time)
  values(trim(p_title), coalesce(p_details,''), p_assigned_to, me.id, p_priority, p_recurrence_type, coalesce(p_recurrence_days,'{}'::int[]), p_start_date, p_end_date, p_deadline_time)
  returning * into template;

  for run_day in select d::date from generate_series(p_start_date, final_day, interval '1 day') d loop
    if p_recurrence_type = 'DAILY' or extract(isodow from run_day)::int = any(coalesce(p_recurrence_days,'{}'::int[])) then
      if not exists (select 1 from recurring_task_instances where recurring_task_id=template.id and run_date=run_day)
        and not exists (
          select 1
          from recurring_task_instances ri
          join recurring_tasks rt on rt.id=ri.recurring_task_id
          where rt.assigned_to=template.assigned_to
            and lower(rt.title)=lower(template.title)
            and ri.run_date=run_day
        ) then
        insert into tasks(title, details, assigned_to, assigned_by, priority, due_date)
        values(template.title, template.details, template.assigned_to, template.assigned_by, template.priority, run_day)
        returning * into new_task;

        insert into recurring_task_instances(recurring_task_id, task_id, run_date)
        values(template.id, new_task.id, run_day)
        on conflict (recurring_task_id, run_date) do nothing;

        created_count := created_count + 1;
      end if;
    end if;
  end loop;

  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values(me.id, 'CREATE_RECURRING_TASK', 'recurring_tasks', template.id,
    jsonb_build_object('assigned_to',p_assigned_to,'recurrence_type',p_recurrence_type,'created_count',created_count));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'RECURRING_TASK_CREATED','recurring_task',template.id,null,'Recurring task created',
    jsonb_build_object('assigned_to',p_assigned_to,'recurrence_type',p_recurrence_type,'created_count',created_count));

  return jsonb_build_object('ok',true,'id',template.id,'created_count',created_count);
end; $$;

create or replace function generate_due_tasks_rpc(p_token text, p_until_date date default current_date + 14)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  template recurring_tasks;
  run_day date;
  final_day date;
  created_count int := 0;
  new_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if me.role <> 'CEO' then return jsonb_build_object('ok',false,'error','CEO only'); end if;

  for template in select * from recurring_tasks where active=true loop
    final_day := least(coalesce(template.end_date, p_until_date), p_until_date, current_date + 90);
    for run_day in select d::date from generate_series(greatest(template.start_date,current_date), final_day, interval '1 day') d loop
      if template.recurrence_type = 'DAILY' or extract(isodow from run_day)::int = any(coalesce(template.recurrence_days,'{}'::int[])) then
        if not exists (select 1 from recurring_task_instances where recurring_task_id=template.id and run_date=run_day)
          and not exists (
            select 1
            from recurring_task_instances ri
            join recurring_tasks rt on rt.id=ri.recurring_task_id
            where rt.assigned_to=template.assigned_to
              and lower(rt.title)=lower(template.title)
              and ri.run_date=run_day
          ) then
          insert into tasks(title, details, assigned_to, assigned_by, priority, due_date)
          values(template.title, template.details, template.assigned_to, template.assigned_by, template.priority, run_day)
          returning * into new_task;
          insert into recurring_task_instances(recurring_task_id, task_id, run_date)
          values(template.id, new_task.id, run_day)
          on conflict (recurring_task_id, run_date) do nothing;
          created_count := created_count + 1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok',true,'created_count',created_count);
end; $$;

create or replace function get_rankings_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  founder_ranking jsonb;
  intern_ranking jsonb;
  department_rankings jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  with task_stats as (
    select assigned_to user_id,
      count(*)::int total,
      count(*) filter(where status='DONE')::int done,
      count(*) filter(where status <> 'DONE' and due_date < current_date)::int overdue,
      count(*) filter(where status='BLOCKED')::int blocked,
      avg(extract(epoch from (completed_at - created_at))/3600) filter(where completed_at is not null)::numeric(10,1) avg_completion_hours,
      count(distinct completed_at::date) filter(where completed_at >= current_date - 14)::int consistency_days,
      sum(case priority when 'URGENT' then 8 when 'HIGH' then 5 when 'MEDIUM' then 3 else 1 end) filter(where status='DONE')::int priority_points
    from tasks
    group by assigned_to
  ),
  proof_stats as (
    select user_id,
      count(*) filter(where is_submission=true)::int submissions,
      count(*) filter(where created_at >= now() - interval '7 days')::int recent_proofs
    from proof_logs
    group by user_id
  ),
  activity_stats as (
    select actor_id user_id, count(*) filter(where created_at >= now() - interval '7 days')::int recent_activity
    from activity_events
    group by actor_id
  ),
  ranked as (
    select u.id,u.name,u.title,u.role,u.strikes,user_department(u) department,
      coalesce(ts.done,0) done,
      coalesce(ts.total,0) total,
      coalesce(ts.overdue,0) overdue,
      coalesce(ts.blocked,0) blocked,
      coalesce(ps.submissions,0) submissions,
      coalesce(ps.recent_proofs,0) recent_proofs,
      coalesce(ast.recent_activity,0) recent_activity,
      coalesce(ts.avg_completion_hours,0) avg_completion_hours,
      coalesce(ts.consistency_days,0) consistency_days,
      (
        coalesce(ts.done,0) * 12
        + coalesce(ps.submissions,0) * 8
        + coalesce(ts.priority_points,0)
        + coalesce(ts.consistency_days,0) * 3
        + least(coalesce(ast.recent_activity,0),20)
        - coalesce(ts.overdue,0) * 15
        - coalesce(ts.blocked,0) * 8
        - coalesce(u.strikes,0) * 25
      )::int score
    from app_users u
    left join task_stats ts on ts.user_id=u.id
    left join proof_stats ps on ps.user_id=u.id
    left join activity_stats ast on ast.user_id=u.id
    where u.active=true and u.role in ('FOUNDER','INTERN')
      and (
        me.role='CEO'
        or u.id=me.id
        or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and user_department(me) <> '' and user_department(me)=user_department(u))
      )
  ),
  numbered as (
    select row_number() over(partition by role order by score desc, name) rank, *
    from ranked
  )
  select jsonb_agg(row_to_json(n) order by n.score desc, n.name) into founder_ranking from numbered n where n.role='FOUNDER';

  with task_stats as (
    select assigned_to user_id,
      count(*)::int total,
      count(*) filter(where status='DONE')::int done,
      count(*) filter(where status <> 'DONE' and due_date < current_date)::int overdue,
      avg(extract(epoch from (completed_at - created_at))/3600) filter(where completed_at is not null)::numeric(10,1) avg_completion_hours,
      count(distinct completed_at::date) filter(where completed_at >= current_date - 14)::int consistency_days,
      sum(case priority when 'URGENT' then 8 when 'HIGH' then 5 when 'MEDIUM' then 3 else 1 end) filter(where status='DONE')::int priority_points
    from tasks group by assigned_to
  ),
  proof_stats as (
    select user_id, count(*) filter(where is_submission=true)::int submissions, count(*) filter(where created_at >= now() - interval '7 days')::int recent_proofs from proof_logs group by user_id
  ),
  activity_stats as (
    select actor_id user_id, count(*) filter(where created_at >= now() - interval '7 days')::int recent_activity from activity_events group by actor_id
  ),
  ranked as (
    select u.id,u.name,u.title,u.role,u.strikes,user_department(u) department,
      coalesce(ts.done,0) done, coalesce(ts.total,0) total, coalesce(ts.overdue,0) overdue,
      coalesce(ps.submissions,0) submissions, coalesce(ps.recent_proofs,0) recent_proofs,
      coalesce(ast.recent_activity,0) recent_activity, coalesce(ts.avg_completion_hours,0) avg_completion_hours,
      coalesce(ts.consistency_days,0) consistency_days,
      (coalesce(ts.done,0)*12 + coalesce(ps.submissions,0)*8 + coalesce(ts.priority_points,0) + coalesce(ts.consistency_days,0)*3 + least(coalesce(ast.recent_activity,0),20) - coalesce(ts.overdue,0)*15 - coalesce(u.strikes,0)*25)::int score
    from app_users u
    left join task_stats ts on ts.user_id=u.id
    left join proof_stats ps on ps.user_id=u.id
    left join activity_stats ast on ast.user_id=u.id
    where u.active=true and u.role='INTERN'
      and (me.role='CEO' or u.id=me.id or (me.role in ('BOARD','FOUNDER') and user_department(me) <> '' and user_department(me)=user_department(u)))
  ),
  numbered as (
    select row_number() over(order by score desc, name) rank, * from ranked
  )
  select jsonb_agg(row_to_json(n) order by n.score desc, n.name) into intern_ranking from numbered n;

  select jsonb_agg(row_to_json(d) order by d.score desc, d.department) into department_rankings
  from (
    select department,
      count(*)::int members,
      sum(score)::int score,
      sum(done)::int completed,
      sum(overdue)::int overdue,
      sum(submissions)::int submissions,
      sum(strikes)::int strikes
    from jsonb_to_recordset(coalesce(intern_ranking,'[]'::jsonb)) as r(department text, score int, done int, overdue int, submissions int, strikes int)
    where department in ('frontend','backend')
    group by department
  ) d;

  return jsonb_build_object('ok',true,'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'department_rankings',coalesce(department_rankings,'[]'::jsonb));
end; $$;

create or replace function get_ai_work_notes_rpc(p_token text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; notes jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into target_user from app_users where id=p_user_id and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'error','User not found'); end if;
  if not can_view_user_summary(me,target_user) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  select jsonb_agg(jsonb_build_object('id',id,'period',period,'note',note,'raw_summary',raw_summary,'created_at',created_at) order by created_at desc)
  into notes
  from (select * from ai_work_notes where user_id=p_user_id order by created_at desc limit 5) n;
  return jsonb_build_object('ok',true,'notes',coalesce(notes,'[]'::jsonb));
end; $$;

create or replace function generate_ai_work_note_rpc(p_token text, p_user_id uuid, p_period text default 'recent', p_note text default null, p_raw_summary jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; summary jsonb; generated_note text; new_note ai_work_notes;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into target_user from app_users where id=p_user_id and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'error','User not found'); end if;
  if not (me.role='CEO' or me.id=target_user.id or (me.role in ('BOARD','FOUNDER') and target_user.role='INTERN' and user_department(me)=user_department(target_user) and user_department(me) <> '')) then
    return jsonb_build_object('ok',false,'error','Not allowed');
  end if;

  summary := jsonb_build_object(
    'completed_tasks',(select count(*) from tasks where assigned_to=p_user_id and status='DONE'),
    'open_tasks',(select count(*) from tasks where assigned_to=p_user_id and status <> 'DONE'),
    'overdue_tasks',(select count(*) from tasks where assigned_to=p_user_id and status <> 'DONE' and due_date < current_date),
    'submissions',(select count(*) from proof_logs where user_id=p_user_id and is_submission=true),
    'recent_activity',(select count(*) from activity_events where actor_id=p_user_id and created_at >= now() - interval '7 days'),
    'strikes',target_user.strikes,
    'ai_enabled',false
  ) || coalesce(p_raw_summary,'{}'::jsonb);

  generated_note := coalesce(nullif(trim(p_note),''), 'AI analysis is disabled. Metrics snapshot: ' || summary::text);

  insert into ai_work_notes(user_id, generated_by, period, note, raw_summary)
  values(p_user_id, me.id, coalesce(nullif(p_period,''),'recent'), generated_note, summary)
  returning * into new_note;

  return jsonb_build_object('ok',true,'note',jsonb_build_object('id',new_note.id,'period',new_note.period,'note',new_note.note,'raw_summary',new_note.raw_summary,'created_at',new_note.created_at),'ai_enabled',false);
end; $$;

create or replace function get_ai_reports_rpc(p_token text, p_period text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; reports jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if me.role <> 'CEO' then return jsonb_build_object('ok',false,'error','CEO only'); end if;

  select jsonb_agg(jsonb_build_object('id',id,'period',period,'report_json',report_json,'ai_summary',ai_summary,'created_at',created_at) order by created_at desc)
  into reports
  from (select * from ai_reports where p_period is null or period=p_period order by created_at desc limit 10) r;
  return jsonb_build_object('ok',true,'reports',coalesce(reports,'[]'::jsonb));
end; $$;

create or replace function generate_ai_report_rpc(p_token text, p_period text default 'weekly', p_ai_summary text default null, p_report_json jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; report ai_reports; metrics jsonb; summary text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if me.role <> 'CEO' then return jsonb_build_object('ok',false,'error','CEO only'); end if;

  metrics := jsonb_build_object(
    'period',coalesce(nullif(p_period,''),'weekly'),
    'completed_tasks',(select count(*) from tasks where status='DONE'),
    'open_tasks',(select count(*) from tasks where status <> 'DONE'),
    'overdue_tasks',(select count(*) from tasks where status <> 'DONE' and due_date < current_date),
    'proof_submissions',(select count(*) from proof_logs where is_submission=true),
    'strikes_total',(select coalesce(sum(strikes),0) from app_users where active=true),
    'ai_enabled',false
  ) || coalesce(p_report_json,'{}'::jsonb);

  summary := coalesce(nullif(trim(p_ai_summary),''), 'AI analysis is disabled. Metrics-only report generated.');

  insert into ai_reports(period, generated_by, report_json, ai_summary)
  values(coalesce(nullif(p_period,''),'weekly'), me.id, metrics, summary)
  returning * into report;

  return jsonb_build_object('ok',true,'report',jsonb_build_object('id',report.id,'period',report.period,'report_json',report.report_json,'ai_summary',report.ai_summary,'created_at',report.created_at),'ai_enabled',false);
end; $$;

grant execute on function user_department(app_users) to anon, authenticated;
grant execute on function can_assign_department_task(app_users, app_users) to anon, authenticated;
grant execute on function can_view_user_summary(app_users, app_users) to anon, authenticated;
grant execute on function create_recurring_task_rpc(text,text,text,uuid,task_priority,text,int[],date,date,time) to anon, authenticated;
grant execute on function generate_due_tasks_rpc(text,date) to anon, authenticated;
grant execute on function get_rankings_rpc(text) to anon, authenticated;
grant execute on function get_ai_work_notes_rpc(text,uuid) to anon, authenticated;
grant execute on function generate_ai_work_note_rpc(text,uuid,text,text,jsonb) to anon, authenticated;
grant execute on function get_ai_reports_rpc(text,text) to anon, authenticated;
grant execute on function generate_ai_report_rpc(text,text,text,jsonb) to anon, authenticated;

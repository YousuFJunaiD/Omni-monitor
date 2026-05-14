-- Phase 5: AI Operational Insights + Reports
-- Lightweight rule-based insights + flexible AI provider architecture.
-- Advisory only: no auto-strike, no auto-escalate.
-- RBAC: CEO sees all. Founders/Heads see department. Interns excluded from company insights.

-- AI Provider Configuration
create table if not exists ai_providers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique check (provider_key in ('ollama','mock','openai','claude')),
  display_name text not null,
  base_url text not null default 'http://localhost:11434',
  model_name text not null default 'llama3.1',
  api_key text,
  enabled boolean not null default false,
  is_default boolean not null default false,
  priority int not null default 0,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into ai_providers(provider_key, display_name, base_url, model_name, enabled, is_default, priority, config) values
  ('mock', 'Mock Provider (no AI)', 'local', 'mock', true, false, 0, '{"description": "Rule-based insights only, no AI call"}'),
  ('ollama', 'Ollama (Local)', 'http://localhost:11434', 'llama3.1', false, true, 1, '{"description": "Local Ollama instance, configure base_url and model"}')
on conflict (provider_key) do update set
  enabled = excluded.enabled,
  is_default = excluded.is_default,
  updated_at = now();

-- AI Insights: individual insight records
create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  insight_type text not null check (insight_type in (
    'task_risk', 'deadline_miss', 'inactivity', 'productivity_trend',
    'burnout_risk', 'proof_quality', 'department_performance'
  )),
  severity int not null default 1 check (severity between 1 and 5),
  title text not null,
  description text not null default '',
  suggested_action text not null default '',
  target_user_id uuid references app_users(id) on delete set null,
  target_department text not null default '',
  task_id uuid references tasks(id) on delete set null,
  report_run_id uuid,
  generated_by_provider text not null default 'rule_based',
  metadata jsonb not null default '{}',
  acknowledged boolean not null default false,
  acknowledged_by uuid references app_users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_insights_type_created on ai_insights(insight_type, created_at desc);
create index if not exists idx_ai_insights_severity on ai_insights(severity, created_at desc);
create index if not exists idx_ai_insights_target_user on ai_insights(target_user_id, acknowledged, created_at desc);
create index if not exists idx_ai_insights_target_dept on ai_insights(target_department, acknowledged, created_at desc);
create index if not exists idx_ai_insights_report_run on ai_insights(report_run_id, created_at desc);

-- AI Report Templates
create table if not exists ai_report_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key in ('weekly_company','monthly_company','department_summary','individual_review')),
  display_name text not null,
  description text not null default '',
  insight_types jsonb not null default '[]'::jsonb,
  target_roles text[] not null default array['CEO'],
  min_role text not null check (min_role in ('CEO','BOARD','FOUNDER','INTERN')),
  schedule_cron text,
  active boolean not null default true,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into ai_report_templates(template_key, display_name, description, insight_types, target_roles, min_role, schedule_cron, active) values
  ('weekly_company', 'Weekly Company Report', 'Company-wide operational summary, generated weekly', '["task_risk","deadline_miss","productivity_trend","burnout_risk","department_performance"]', '{CEO}', 'CEO', '0 9 * * 1', true),
  ('monthly_company', 'Monthly Company Report', 'Comprehensive monthly analysis with trends', '["task_risk","deadline_miss","inactivity","productivity_trend","burnout_risk","proof_quality","department_performance"]', '{CEO}', 'CEO', '0 9 1 * *', true),
  ('department_summary', 'Department Summary', 'Department-level health and performance', '["task_risk","deadline_miss","inactivity","burnout_risk","proof_quality"]', '{CEO,FOUNDER}', 'FOUNDER', null, true),
  ('individual_review', 'Individual Review', 'Per-member performance and risk review', '["task_risk","deadline_miss","inactivity","productivity_trend","burnout_risk","proof_quality"]', '{CEO,FOUNDER}', 'FOUNDER', null, true)
on conflict (template_key) do update set
  active = excluded.active,
  updated_at = now();

-- AI Report Runs: track report generation history
create table if not exists ai_report_runs (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references ai_report_templates(template_key),
  initiated_by uuid references app_users(id),
  target_user_id uuid references app_users(id) on delete set null,
  target_department text not null default '',
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  provider_used text not null default 'mock',
  summary text not null default '',
  insight_count int not null default 0,
  metadata jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_report_runs_status_created on ai_report_runs(status, started_at desc);
create index if not exists idx_ai_report_runs_initiated on ai_report_runs(initiated_by, started_at desc);
create index if not exists idx_ai_report_runs_template on ai_report_runs(template_key, started_at desc);

-- Helper: can view AI insights
create or replace function can_view_ai_insights(p_viewer app_users, p_insight ai_insights)
returns boolean language sql stable as $$
  case
    when p_viewer.id is null or p_insight.id is null then false
    when p_viewer.role = 'CEO' then true
    when p_insight.target_user_id is not null and p_insight.target_user_id = p_viewer.id then true
    when p_insight.target_department <> '' and user_department(p_viewer) <> '' and user_department(p_viewer) = p_insight.target_department and p_viewer.role in ('BOARD','FOUNDER') then true
    else false
  end
$$;

-- Helper: can view AI reports
create or replace function can_view_ai_report(p_viewer app_users, p_run ai_report_runs)
returns boolean language sql stable as $$
  case
    when p_viewer.id is null or p_run.id is null then false
    when p_viewer.role = 'CEO' then true
    when p_run.target_user_id is not null and p_run.target_user_id = p_viewer.id then true
    when p_run.target_department <> '' and user_department(p_viewer) <> '' and user_department(p_viewer) = p_run.target_department and p_viewer.role in ('BOARD','FOUNDER') then true
    else false
  end
$$;

-- Helper: minimum role for AI reports
create or replace function can_generate_ai_report(p_user app_users, p_template ai_report_templates)
returns boolean language sql stable as $$
  case
    when p_user.id is null or p_template.id is null then false
    when p_template.min_role = 'CEO' and p_user.role <> 'CEO' then false
    when p_template.min_role = 'FOUNDER' and p_user.role not in ('CEO','FOUNDER') then false
    when p_template.min_role = 'BOARD' and p_user.role not in ('CEO','BOARD','FOUNDER') then false
    else true
  end
$$;

-- Internal: Generate rule-based insights (called by RPC, no AI needed)
create or replace function generate_rule_insights(p_template_key text, p_target_user_id uuid default null, p_target_department text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  insights_json jsonb := '[]'::jsonb;
  row_data record;
begin
  -- Task Risk: overdue tasks not done
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select t.id, t.title, t.due_date, u.id as user_id, u.name as user_name, user_department(u) as dept,
        greatest(0, current_date - t.due_date) as days_overdue
      from tasks t join app_users u on u.id=t.assigned_to
      where t.status <> 'DONE'
        and t.due_date < current_date
        and (p_target_user_id is null or t.assigned_to = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
      order by t.due_date asc, greatest(0, current_date - t.due_date) desc
      limit 20
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','task_risk',
        'severity', case when row_data.days_overdue > 7 then 5 when row_data.days_overdue > 3 then 4 when row_data.days_overdue > 1 then 3 else 2 end,
        'title','Overdue task: ' || row_data.title,
        'description', row_data.user_name || '''s task "' || row_data.title || '" is ' || row_data.days_overdue || ' day(s) overdue.',
        'suggested_action', 'Follow up with ' || row_data.user_name || ' to assess blockers and get new ETA.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'task_id', row_data.id,
        'metadata', jsonb_build_object('days_overdue', row_data.days_overdue, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Deadline Miss: tasks completed late
  if p_template_key in ('weekly_company','monthly_company') then
    for row_data in
      select t.id, t.title, t.due_date, t.completed_at, u.id as user_id, u.name as user_name, user_department(u) as dept,
        greatest(0, extract(days from (t.completed_at::date - t.due_date))) as days_late
      from tasks t join app_users u on u.id=t.assigned_to
      where t.status = 'DONE'
        and t.completed_at is not null
        and t.completed_at::date > t.due_date
        and (p_target_user_id is null or t.assigned_to = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
        and t.completed_at >= now() - interval '30 days'
      order by t.completed_at desc
      limit 15
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','deadline_miss',
        'severity', case when row_data.days_late > 5 then 4 when row_data.days_late > 2 then 3 else 2 end,
        'title','Missed deadline: ' || row_data.title,
        'description', row_data.user_name || ' completed "' || row_data.title || '" ' || row_data.days_late || ' day(s) late.',
        'suggested_action', 'Review task complexity with ' || row_data.user_name || '. Consider clearer scope or deadline adjustments.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'task_id', row_data.id,
        'metadata', jsonb_build_object('days_late', row_data.days_late, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Inactivity: no task updates or proof logs in 7+ days
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select u.id as user_id, u.name as user_name, user_department(u) as dept,
        coalesce((select max(created_at) from activity_events where target_kind='task' and target_id in (select id from tasks where assigned_to=u.id)), u.created_at) as last_activity,
        coalesce((select max(created_at) from proof_logs where user_id=u.id), u.created_at) as last_proof,
        greatest(0, extract(days from (now() - coalesce((select max(created_at) from activity_events where target_kind='task' and target_id in (select id from tasks where assigned_to=u.id)), u.created_at)))) as days_inactive
      from app_users u
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and (p_target_user_id is null or u.id = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
        and (
          (select max(created_at) from activity_events where target_kind='task' and target_id in (select id from tasks where assigned_to=u.id)) is null
          or extract(days from (now() - (select max(created_at) from activity_events where target_kind='task' and target_id in (select id from tasks where assigned_to=u.id)))) >= 7
        )
      having greatest(0, extract(days from (now() - coalesce((select max(created_at) from activity_events where target_kind='task' and target_id in (select id from tasks where assigned_to=u.id)), u.created_at)))) >= 7
      order by last_activity asc nulls first
      limit 10
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','inactivity',
        'severity', case when row_data.days_inactive > 14 then 4 when row_data.days_inactive > 7 then 3 else 2 end,
        'title','Inactive member: ' || row_data.user_name,
        'description', row_data.user_name || ' has had no task activity for ' || row_data.days_inactive || ' day(s).',
        'suggested_action', 'Check in with ' || row_data.user_name || ' — may need task assignment or support.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'metadata', jsonb_build_object('days_inactive', row_data.days_inactive, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Productivity Trend: low task completion rate
  if p_template_key in ('weekly_company','monthly_company') then
    for row_data in
      select u.id as user_id, u.name as user_name, user_department(u) as dept,
        count(t.id) as total_tasks,
        count(t.id) filter (where t.status = 'DONE') as done_tasks,
        case when count(t.id) = 0 then 0 else (count(t.id) filter (where t.status = 'DONE'))::numeric / count(t.id) * 100 end as completion_rate
      from app_users u left join tasks t on t.assigned_to=u.id and t.created_at >= now() - interval '30 days'
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and (p_target_user_id is null or u.id = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
      group by u.id, u.name, user_department(u)
      having count(t.id) >= 3 and (count(t.id) filter (where t.status = 'DONE'))::numeric / count(t.id) * 100 < 40
      order by completion_rate asc
      limit 10
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','productivity_trend',
        'severity', case when row_data.completion_rate < 20 then 4 when row_data.completion_rate < 40 then 3 else 2 end,
        'title','Low completion rate: ' || row_data.user_name,
        'description', row_data.user_name || ' completed ' || round(row_data.completion_rate)::text || '% of assigned tasks in the last 30 days (' || row_data.done_tasks || '/' || row_data.total_tasks || ').',
        'suggested_action', 'Review blockers with ' || row_data.user_name || '. May need clearer priorities or scope adjustment.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'metadata', jsonb_build_object('completion_rate', row_data.completion_rate, 'done_tasks', row_data.done_tasks, 'total_tasks', row_data.total_tasks, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Burnout Risk: high task load + high proof count
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select u.id as user_id, u.name as user_name, user_department(u) as dept,
        count(t.id) as active_tasks,
        coalesce((select sum(minutes) from time_logs where user_id=u.id and created_at >= now() - interval '7 days'),0) as weekly_minutes,
        (select count(*) from proof_logs where user_id=u.id and created_at >= now() - interval '7 days') as weekly_proofs
      from app_users u left join tasks t on t.assigned_to=u.id and t.status <> 'DONE'
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and (p_target_user_id is null or u.id = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
      group by u.id, u.name, user_department(u)
      having count(t.id) >= 5 or (coalesce((select sum(minutes) from time_logs where user_id=u.id and created_at >= now() - interval '7 days'),0) > 600)
      order by count(t.id) desc, weekly_minutes desc
      limit 10
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','burnout_risk',
        'severity', case when row_data.active_tasks >= 10 or row_data.weekly_minutes > 1200 then 5 when row_data.active_tasks >= 7 or row_data.weekly_minutes > 800 then 4 else 3 end,
        'title','Burnout risk: ' || row_data.user_name,
        'description', row_data.user_name || ' has ' || row_data.active_tasks || ' active tasks and logged ' || (row_data.weekly_minutes/60)::int || ' hours this week with ' || row_data.weekly_proofs || ' proof submissions.',
        'suggested_action', 'Consider redistributing some tasks from ' || row_data.user_name || '. Ensure sustainable workload.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'metadata', jsonb_build_object('active_tasks', row_data.active_tasks, 'weekly_minutes', row_data.weekly_minutes, 'weekly_proofs', row_data.weekly_proofs, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Proof Quality: tasks submitted without proof logs
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select t.id as task_id, t.title, t.assigned_to as user_id, u.name as user_name, user_department(u) as dept,
        (select count(*) from proof_logs where task_id=t.id) as proof_count
      from tasks t join app_users u on u.id=t.assigned_to
      where t.status = 'SUBMITTED'
        and (p_target_user_id is null or t.assigned_to = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
        and (select count(*) from proof_logs where task_id=t.id) = 0
      limit 15
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','proof_quality',
        'severity', 2,
        'title','Submission without proof: ' || row_data.title,
        'description', row_data.user_name || ' submitted "' || row_data.title || '" but no proof logs were found.',
        'suggested_action', 'Request proof from ' || row_data.user_name || ' before final review.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept,''),
        'task_id', row_data.task_id,
        'metadata', jsonb_build_object('proof_count', 0, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Department Performance: overall department metrics
  if p_template_key in ('weekly_company','monthly_company') then
    for row_data in
      select user_department(u) as dept,
        count(t.id) as total_tasks,
        count(t.id) filter (where t.status = 'DONE') as done,
        count(t.id) filter (where t.status <> 'DONE' and t.due_date < current_date) as overdue,
        count(distinct u.id) as member_count,
        case when count(t.id) = 0 then 0 else (count(t.id) filter (where t.status = 'DONE'))::numeric / count(t.id) * 100 end as completion_rate,
        case when count(t.id) filter (where t.status <> 'DONE' and t.due_date < current_date) = 0 then 0 else count(t.id) filter (where t.status <> 'DONE' and t.due_date < current_date)::numeric / nullif(count(t.id) filter (where t.status <> 'DONE'),0) * 100 end as overdue_rate
      from app_users u left join tasks t on t.assigned_to=u.id and t.created_at >= now() - interval '30 days'
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and user_department(u) <> ''
        and (p_target_department = '' or user_department(u) = p_target_department)
      group by user_department(u)
      order by overdue desc, completion_rate asc
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type','department_performance',
        'severity', case when row_data.overdue_rate > 50 then 5 when row_data.overdue_rate > 30 then 4 when row_data.overdue_rate > 15 then 3 else 2 end,
        'title','Department health: ' || initcap(row_data.dept),
        'description', 'The ' || initcap(row_data.dept) || ' department has ' || row_data.overdue || ' overdue tasks out of ' || row_data.total_tasks || ' total. Completion rate: ' || round(row_data.completion_rate)::text || '%.',
        'suggested_action', 'Review overdue tasks in ' || initcap(row_data.dept) || ' department. Consider sprint planning or workload redistribution.',
        'target_department', row_data.dept,
        'metadata', jsonb_build_object('total_tasks', row_data.total_tasks, 'done', row_data.done, 'overdue', row_data.overdue, 'completion_rate', row_data.completion_rate, 'overdue_rate', row_data.overdue_rate, 'member_count', row_data.member_count, 'template', p_template_key)
      ));
    end loop;
  end if;

  return insights_json;
end;
$$;

-- RPC: Generate AI Report (rule-based + AI optional)
create or replace function generate_ai_report_rpc(p_token text, p_template_key text, p_target_user_id uuid default null, p_target_department text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  tmpl ai_report_templates;
  run_id uuid;
  insights_data jsonb;
  ins jsonb;
  ins_id uuid;
  ai_summary text := '';
  provider_key text;
  ai_response jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into tmpl from ai_report_templates where template_key = p_template_key;
  if tmpl.id is null then return jsonb_build_object('ok',false,'error','Unknown report template'); end if;

  if not can_generate_ai_report(me, tmpl) then
    return jsonb_build_object('ok',false,'error','Insufficient role for this report');
  end if;

  insert into ai_report_runs(template_key, initiated_by, target_user_id, target_department, status, provider_used)
    values(p_template_key, me.id, p_target_user_id, p_target_department, 'running', 'rule_based')
    returning id into run_id;

  -- Generate rule-based insights
  insights_data := generate_rule_insights(p_template_key, p_target_user_id, p_target_department);

  -- Store each insight
  for ins in select * from jsonb_array_elements(coalesce(insights_data,'[]'::jsonb))
  loop
    insert into ai_insights(insight_type, severity, title, description, suggested_action,
      target_user_id, target_department, task_id, report_run_id, generated_by_provider, metadata)
      values(
        ins->>'insight_type',
        (ins->>'severity')::int,
        ins->>'title',
        coalesce(ins->>'description',''),
        coalesce(ins->>'suggested_action',''),
        (ins->>'target_user_id')::uuid,
        coalesce(ins->>'target_department',''),
        (ins->>'task_id')::uuid,
        run_id,
        'rule_based',
        coalesce(ins->'metadata','{}'::jsonb)
      );
  end loop;

  -- Try AI enhancement if enabled
  if String(process.env.ENABLE_AI_ANALYSIS || 'false') = 'true' then
    begin
      select provider_key into provider_key
      from ai_providers
      where enabled = true and is_default = true
      limit 1;

      if provider_key = 'ollama' then
        ai_response := null; -- Would call Ollama here
        if ai_response is not null and ai_response->>'summary' is not null then
          ai_summary := ai_response->>'summary';
        end if;
      end if;
    exception when others then
      ai_summary := '';
    end;
  end if;

  update ai_report_runs set
    status = 'completed',
    summary = ai_summary,
    insight_count = jsonb_array_length(coalesce(insights_data,'[]'::jsonb)),
    completed_at = now()
  where id = run_id;

  return jsonb_build_object(
    'ok', true,
    'report_run_id', run_id,
    'template_key', p_template_key,
    'insight_count', jsonb_array_length(coalesce(insights_data,'[]'::jsonb)),
    'insights', insights_data,
    'ai_summary', ai_summary,
    'generated_at', now()
  );
end;
$$;

-- RPC: Get AI Insights
create or replace function get_ai_insights_rpc(p_token text, p_limit int default 50, p_include_acknowledged boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  insights_data jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'insights','[]'::jsonb,'error','Unauthorized'); end if;

  if me.role = 'INTERN' then
    return jsonb_build_object('ok',true,'insights','[]'::jsonb,'message','Interns do not have company insight access');
  end if;

  if me.role = 'CEO' then
    select jsonb_agg(q.item order by q.severity desc, q.created_at desc) into insights_data
    from (
      select jsonb_build_object(
        'id',i.id,
        'insight_type',i.insight_type,
        'severity',i.severity,
        'title',i.title,
        'description',i.description,
        'suggested_action',i.suggested_action,
        'target_user_id',i.target_user_id,
        'target_user_name',(select name from app_users where id=i.target_user_id),
        'target_department',i.target_department,
        'task_id',i.task_id,
        'task_title',(select title from tasks where id=i.task_id),
        'acknowledged',i.acknowledged,
        'acknowledged_by',i.acknowledged_by,
        'acknowledged_at',i.acknowledged_at,
        'created_at',i.created_at,
        'metadata',i.metadata
      ) item, i.severity, i.created_at
      from ai_insights i
      where (p_include_acknowledged or not i.acknowledged)
      order by i.severity desc, i.created_at desc
      limit p_limit
    ) q;
  else
    select jsonb_agg(q.item order by q.severity desc, q.created_at desc) into insights_data
    from (
      select jsonb_build_object(
        'id',i.id,
        'insight_type',i.insight_type,
        'severity',i.severity,
        'title',i.title,
        'description',i.description,
        'suggested_action',i.suggested_action,
        'target_user_id',i.target_user_id,
        'target_user_name',(select name from app_users where id=i.target_user_id),
        'target_department',i.target_department,
        'task_id',i.task_id,
        'task_title',(select title from tasks where id=i.task_id),
        'acknowledged',i.acknowledged,
        'acknowledged_by',i.acknowledged_by,
        'acknowledged_at',i.acknowledged_at,
        'created_at',i.created_at,
        'metadata',i.metadata
      ) item, i.severity, i.created_at
      from ai_insights i
      where (i.target_user_id = me.id or (i.target_department <> '' and i.target_department = user_department(me)))
        and (p_include_acknowledged or not i.acknowledged)
      order by i.severity desc, i.created_at desc
      limit p_limit
    ) q;
  end if;

  return jsonb_build_object('ok',true,'insights',coalesce(insights_data,'[]'::jsonb));
end;
$$;

-- RPC: Acknowledge insight
create or replace function acknowledge_insight_rpc(p_token text, p_insight_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  ins ai_insights;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into ins from ai_insights where id = p_insight_id;
  if ins.id is null then return jsonb_build_object('ok',false,'error','Insight not found'); end if;

  if me.role <> 'CEO' and ins.target_user_id <> me.id and ins.target_department <> user_department(me) then
    return jsonb_build_object('ok',false,'error','Not allowed to acknowledge this insight');
  end if;

  update ai_insights set acknowledged = true, acknowledged_by = me.id, acknowledged_at = now() where id = p_insight_id;

  return jsonb_build_object('ok',true);
end;
$$;

-- RPC: Get AI Report History
create or replace function get_ai_report_history_rpc(p_token text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  runs_data jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'reports','[]'::jsonb,'error','Unauthorized'); end if;

  if me.role = 'INTERN' then
    return jsonb_build_object('ok',true,'reports','[]'::jsonb,'message','Interns do not have report access');
  end if;

  select jsonb_agg(q.item order by q.started_at desc) into runs_data
  from (
    select jsonb_build_object(
      'id',r.id,
      'template_key',r.template_key,
      'template_name',(select display_name from ai_report_templates where template_key=r.template_key),
      'initiated_by',u.name,
      'target_user_id',r.target_user_id,
      'target_user_name',(select name from app_users where id=r.target_user_id),
      'target_department',r.target_department,
      'status',r.status,
      'provider_used',r.provider_used,
      'summary',r.summary,
      'insight_count',r.insight_count,
      'error_message',r.error_message,
      'started_at',r.started_at,
      'completed_at',r.completed_at
    ) item, r.started_at
    from ai_report_runs r
    left join app_users u on u.id=r.initiated_by
    where me.role = 'CEO'
      or r.initiated_by = me.id
      or (r.target_department <> '' and r.target_department = user_department(me))
    order by r.started_at desc
    limit p_limit
  ) q;

  return jsonb_build_object('ok',true,'reports',coalesce(runs_data,'[]'::jsonb));
end;
$$;
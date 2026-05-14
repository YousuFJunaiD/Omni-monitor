-- Phase 4: smart task templates + recurring workflow upgrade.
-- Additive: preserves existing task creation, recurring generation, proof/review/timeline flows.

create table if not exists task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  default_priority task_priority not null default 'MEDIUM',
  default_department text not null default '',
  default_estimated_minutes int not null default 0,
  default_proof_requirement text not null default '',
  default_checklist jsonb not null default '[]'::jsonb,
  created_by uuid not null references app_users(id),
  visibility text not null default 'private' check (visibility in ('private','department','company')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_template_assignments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references task_templates(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  recurring_task_id uuid references recurring_tasks(id) on delete set null,
  assigned_to uuid not null references app_users(id),
  assigned_by uuid not null references app_users(id),
  run_date date,
  created_at timestamptz not null default now()
);

alter table tasks add column if not exists template_id uuid references task_templates(id) on delete set null;
alter table tasks add column if not exists recurring_task_id uuid references recurring_tasks(id) on delete set null;
alter table tasks add column if not exists estimated_minutes int not null default 0;
alter table tasks add column if not exists proof_requirement text not null default '';
alter table tasks add column if not exists checklist jsonb not null default '[]'::jsonb;

alter table recurring_tasks add column if not exists template_id uuid references task_templates(id) on delete set null;
alter table recurring_tasks add column if not exists estimated_minutes int not null default 0;
alter table recurring_tasks add column if not exists proof_requirement text not null default '';
alter table recurring_tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table recurring_tasks add column if not exists paused_at timestamptz;
alter table recurring_tasks add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_task_templates_visibility_department on task_templates(archived, visibility, default_department, created_at desc);
create index if not exists idx_task_templates_created_by on task_templates(created_by, archived, created_at desc);
create index if not exists idx_task_template_assignments_template_created on task_template_assignments(template_id, created_at desc);
create index if not exists idx_tasks_template_created on tasks(template_id, created_at desc);
create index if not exists idx_tasks_recurring_created on tasks(recurring_task_id, created_at desc);
create index if not exists idx_recurring_tasks_template_active on recurring_tasks(template_id, active, start_date);

create or replace function template_department(p_template task_templates)
returns text language sql stable as $$
  select lower(coalesce(p_template.default_department,''))
$$;

create or replace function can_view_task_template(p_viewer app_users, p_template task_templates)
returns boolean language sql stable as $$
  select case
    when p_viewer.id is null or p_template.id is null then false
    when p_viewer.role = 'CEO' then true
    when p_template.created_by = p_viewer.id then true
    when p_template.visibility = 'company' and p_viewer.role in ('BOARD','FOUNDER') then true
    when p_template.visibility = 'department'
      then user_department(p_viewer) <> ''
        and user_department(p_viewer) = template_department(p_template)
    else false
  end
$$;

create or replace function can_manage_task_template(p_manager app_users, p_template task_templates)
returns boolean language sql stable as $$
  select case
    when p_manager.id is null or p_template.id is null then false
    when p_manager.role = 'CEO' then true
    when p_template.created_by = p_manager.id then true
    when p_manager.role in ('BOARD','FOUNDER') and p_template.visibility = 'department'
      then user_department(p_manager) <> ''
        and user_department(p_manager) = template_department(p_template)
    else false
  end
$$;

create or replace function task_template_json(p_template task_templates)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',p_template.id,
    'title',p_template.title,
    'description',p_template.description,
    'default_priority',p_template.default_priority,
    'default_department',p_template.default_department,
    'default_estimated_minutes',p_template.default_estimated_minutes,
    'default_proof_requirement',p_template.default_proof_requirement,
    'default_checklist',p_template.default_checklist,
    'created_by',p_template.created_by,
    'created_by_name',(select name from app_users where id=p_template.created_by),
    'visibility',p_template.visibility,
    'archived',p_template.archived,
    'created_at',p_template.created_at,
    'updated_at',p_template.updated_at
  )
$$;

create or replace function get_task_templates_rpc(p_token text, p_include_archived boolean default false, p_limit int default 80)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; payload jsonb; safe_limit int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'templates','[]'::jsonb,'error','Unauthorized'); end if;
  safe_limit := least(greatest(coalesce(p_limit,80),1),120);

  select jsonb_agg(q.item order by q.updated_at desc, q.created_at desc) into payload
  from (
    select jsonb_build_object(
      'id',tt.id,
      'title',tt.title,
      'description',tt.description,
      'default_priority',tt.default_priority,
      'default_department',tt.default_department,
      'default_estimated_minutes',tt.default_estimated_minutes,
      'default_proof_requirement',tt.default_proof_requirement,
      'default_checklist',tt.default_checklist,
      'created_by',tt.created_by,
      'created_by_name',creator.name,
      'visibility',tt.visibility,
      'archived',tt.archived,
      'created_at',tt.created_at,
      'updated_at',tt.updated_at
    ) item, tt.updated_at, tt.created_at
    from task_templates tt
    left join app_users creator on creator.id=tt.created_by
    where (p_include_archived or tt.archived=false)
      and can_view_task_template(me, tt)
    order by tt.updated_at desc, tt.created_at desc
    limit safe_limit
  ) q;

  return jsonb_build_object('ok',true,'templates',coalesce(payload,'[]'::jsonb),'error',null);
end; $$;

create or replace function upsert_task_template_rpc(
  p_token text,
  p_template_id uuid default null,
  p_title text default '',
  p_description text default '',
  p_default_priority task_priority default 'MEDIUM',
  p_default_department text default '',
  p_default_estimated_minutes int default 0,
  p_default_proof_requirement text default '',
  p_default_checklist jsonb default '[]'::jsonb,
  p_visibility text default 'private'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; existing task_templates; saved task_templates; normalized_department text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  if me.role = 'INTERN' then return jsonb_build_object('ok',false,'data',null,'error','Interns cannot manage templates'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Template title is required'); end if;
  if p_visibility not in ('private','department','company') then return jsonb_build_object('ok',false,'data',null,'error','Invalid visibility'); end if;
  if p_visibility = 'company' and me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO only for company templates'); end if;

  normalized_department := lower(coalesce(nullif(trim(p_default_department),''), user_department(me)));
  if p_visibility = 'department' and normalized_department = '' then
    return jsonb_build_object('ok',false,'data',null,'error','Department is required');
  end if;
  if me.role <> 'CEO' and normalized_department <> '' and normalized_department <> user_department(me) then
    return jsonb_build_object('ok',false,'data',null,'error','Cannot manage another department template');
  end if;

  if p_template_id is null then
    insert into task_templates(title,description,default_priority,default_department,default_estimated_minutes,default_proof_requirement,default_checklist,created_by,visibility)
    values(trim(p_title),coalesce(p_description,''),p_default_priority,normalized_department,greatest(coalesce(p_default_estimated_minutes,0),0),
      coalesce(p_default_proof_requirement,''),coalesce(p_default_checklist,'[]'::jsonb),me.id,p_visibility)
    returning * into saved;

    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_TEMPLATE_CREATED','task_template',saved.id,null,'Task template created',jsonb_build_object('visibility',p_visibility,'department',normalized_department));
  else
    select * into existing from task_templates where id=p_template_id;
    if existing.id is null then return jsonb_build_object('ok',false,'data',null,'error','Template not found'); end if;
    if not can_manage_task_template(me, existing) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

    update task_templates
    set title=trim(p_title),
      description=coalesce(p_description,''),
      default_priority=p_default_priority,
      default_department=normalized_department,
      default_estimated_minutes=greatest(coalesce(p_default_estimated_minutes,0),0),
      default_proof_requirement=coalesce(p_default_proof_requirement,''),
      default_checklist=coalesce(p_default_checklist,'[]'::jsonb),
      visibility=p_visibility,
      updated_at=now()
    where id=p_template_id
    returning * into saved;

    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_TEMPLATE_UPDATED','task_template',saved.id,null,'Task template updated',jsonb_build_object('visibility',p_visibility,'department',normalized_department));
  end if;

  return jsonb_build_object('ok',true,'data',task_template_json(saved),'error',null);
end; $$;

create or replace function create_template_from_task_rpc(
  p_token text,
  p_task_id uuid,
  p_visibility text default 'private'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; assignee app_users; saved task_templates; normalized_department text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  if me.role = 'INTERN' then return jsonb_build_object('ok',false,'data',null,'error','Interns cannot manage templates'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not can_view_review_task(me, task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  if p_visibility = 'company' and me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO only for company templates'); end if;

  select * into assignee from app_users where id=task_row.assigned_to;
  normalized_department := coalesce(nullif(user_department(assignee),''), user_department(me));
  if p_visibility = 'department' and normalized_department = '' then
    return jsonb_build_object('ok',false,'data',null,'error','Department is required');
  end if;
  if me.role <> 'CEO' and normalized_department <> '' and normalized_department <> user_department(me) then
    return jsonb_build_object('ok',false,'data',null,'error','Cannot create another department template');
  end if;

  insert into task_templates(title,description,default_priority,default_department,default_estimated_minutes,default_proof_requirement,default_checklist,created_by,visibility)
  values(task_row.title,coalesce(task_row.details,''),task_row.priority,normalized_department,
    coalesce(task_row.estimated_minutes,0),coalesce(task_row.proof_requirement,''),coalesce(task_row.checklist,'[]'::jsonb),me.id,p_visibility)
  returning * into saved;

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_TEMPLATE_CREATED','task_template',saved.id,task_row.id,'Task template created from task',jsonb_build_object('source_task_id',task_row.id));

  return jsonb_build_object('ok',true,'data',task_template_json(saved),'error',null);
end; $$;

create or replace function archive_task_template_rpc(p_token text, p_template_id uuid, p_archived boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; existing task_templates; saved task_templates;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into existing from task_templates where id=p_template_id;
  if existing.id is null then return jsonb_build_object('ok',false,'error','Template not found'); end if;
  if not can_manage_task_template(me, existing) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  update task_templates set archived=coalesce(p_archived,true), updated_at=now() where id=p_template_id returning * into saved;

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,case when saved.archived then 'TASK_TEMPLATE_ARCHIVED' else 'TASK_TEMPLATE_RESTORED' end,'task_template',saved.id,null,
    case when saved.archived then 'Task template archived' else 'Task template restored' end,jsonb_build_object('archived',saved.archived));

  return jsonb_build_object('ok',true,'data',task_template_json(saved),'error',null);
end; $$;

create or replace function assign_task_template_rpc(
  p_token text,
  p_template_id uuid,
  p_assigned_to uuid[],
  p_due_date date default null,
  p_recurrence_type text default 'ONE_TIME',
  p_recurrence_days int[] default '{}',
  p_start_date date default null,
  p_end_date date default null,
  p_deadline_time time default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  tpl task_templates;
  assignee_id uuid;
  target_user app_users;
  new_task tasks;
  recurring recurring_tasks;
  run_day date;
  final_day date;
  created_count int := 0;
  recurring_count int := 0;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'created_count',0,'error','Unauthorized'); end if;

  select * into tpl from task_templates where id=p_template_id and archived=false;
  if tpl.id is null then return jsonb_build_object('ok',false,'created_count',0,'error','Template not found'); end if;
  if not can_view_task_template(me, tpl) then return jsonb_build_object('ok',false,'created_count',0,'error','Not allowed'); end if;
  if coalesce(array_length(p_assigned_to,1),0) = 0 then return jsonb_build_object('ok',false,'created_count',0,'error','Choose at least one assignee'); end if;
  if p_recurrence_type not in ('ONE_TIME','DAILY','WEEKLY_DAYS') then return jsonb_build_object('ok',false,'created_count',0,'error','Invalid recurrence'); end if;
  if p_recurrence_type = 'WEEKLY_DAYS' and coalesce(array_length(p_recurrence_days,1),0) = 0 then
    return jsonb_build_object('ok',false,'created_count',0,'error','Choose at least one day');
  end if;

  foreach assignee_id in array p_assigned_to loop
    select * into target_user from app_users where id=assignee_id and active=true;
    if target_user.id is null then return jsonb_build_object('ok',false,'created_count',created_count,'error','Invalid assignee'); end if;
    if not can_assign_department_task(me, target_user) then return jsonb_build_object('ok',false,'created_count',created_count,'error','Not allowed to assign one or more users'); end if;

    if p_recurrence_type = 'ONE_TIME' then
      insert into tasks(title, details, assigned_to, assigned_by, priority, due_date, template_id, estimated_minutes, proof_requirement, checklist)
      values(tpl.title, tpl.description, assignee_id, me.id, tpl.default_priority, p_due_date, tpl.id,
        tpl.default_estimated_minutes, tpl.default_proof_requirement, tpl.default_checklist)
      returning * into new_task;

      insert into task_template_assignments(template_id, task_id, assigned_to, assigned_by, run_date)
      values(tpl.id, new_task.id, assignee_id, me.id, p_due_date);

      insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
      values(me.id,'TASK_CREATED_FROM_TEMPLATE','task_template',tpl.id,new_task.id,'Task created from template',
        jsonb_build_object('assigned_to',assignee_id,'template_id',tpl.id));

      created_count := created_count + 1;
    else
      if p_start_date is null then return jsonb_build_object('ok',false,'created_count',created_count,'error','Start date is required'); end if;
      final_day := least(coalesce(p_end_date, p_start_date + 30), p_start_date + 180);
      if final_day < p_start_date then return jsonb_build_object('ok',false,'created_count',created_count,'error','End date must be after start date'); end if;

      insert into recurring_tasks(title, details, assigned_to, assigned_by, priority, recurrence_type, recurrence_days, start_date, end_date, deadline_time,
        template_id, estimated_minutes, proof_requirement, checklist)
      values(tpl.title, tpl.description, assignee_id, me.id, tpl.default_priority, p_recurrence_type, coalesce(p_recurrence_days,'{}'::int[]),
        p_start_date, p_end_date, p_deadline_time, tpl.id, tpl.default_estimated_minutes, tpl.default_proof_requirement, tpl.default_checklist)
      returning * into recurring;
      recurring_count := recurring_count + 1;

      insert into task_template_assignments(template_id, recurring_task_id, assigned_to, assigned_by)
      values(tpl.id, recurring.id, assignee_id, me.id);

      for run_day in select d::date from generate_series(p_start_date, final_day, interval '1 day') d loop
        if p_recurrence_type = 'DAILY' or extract(isodow from run_day)::int = any(coalesce(p_recurrence_days,'{}'::int[])) then
          if not exists (
            select 1
            from recurring_task_instances ri
            join recurring_tasks rt on rt.id=ri.recurring_task_id
            where rt.assigned_to=assignee_id
              and lower(rt.title)=lower(tpl.title)
              and ri.run_date=run_day
          ) then
            insert into tasks(title, details, assigned_to, assigned_by, priority, due_date, template_id, recurring_task_id, estimated_minutes, proof_requirement, checklist)
            values(tpl.title, tpl.description, assignee_id, me.id, tpl.default_priority, run_day, tpl.id, recurring.id,
              tpl.default_estimated_minutes, tpl.default_proof_requirement, tpl.default_checklist)
            returning * into new_task;

            insert into recurring_task_instances(recurring_task_id, task_id, run_date)
            values(recurring.id, new_task.id, run_day)
            on conflict (recurring_task_id, run_date) do nothing;

            created_count := created_count + 1;
          end if;
        end if;
      end loop;

      insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
      values(me.id,'RECURRING_TASK_CREATED','recurring_task',recurring.id,null,'Recurring task created from template',
        jsonb_build_object('template_id',tpl.id,'assigned_to',assignee_id,'recurrence_type',p_recurrence_type));
    end if;
  end loop;

  return jsonb_build_object('ok',true,'created_count',created_count,'recurring_count',recurring_count,'error',null);
end; $$;

create or replace function set_recurring_task_active_rpc(p_token text, p_recurring_task_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; recurring recurring_tasks; assignee app_users; saved recurring_tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into recurring from recurring_tasks where id=p_recurring_task_id;
  if recurring.id is null then return jsonb_build_object('ok',false,'error','Recurring task not found'); end if;
  select * into assignee from app_users where id=recurring.assigned_to;
  if not (me.role='CEO' or recurring.assigned_by=me.id or can_assign_department_task(me, assignee)) then
    return jsonb_build_object('ok',false,'error','Not allowed');
  end if;

  update recurring_tasks
  set active=coalesce(p_active,true),
    paused_at=case when coalesce(p_active,true) then null else now() end,
    updated_at=now()
  where id=p_recurring_task_id
  returning * into saved;

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,case when saved.active then 'RECURRING_TASK_RESUMED' else 'RECURRING_TASK_PAUSED' end,'recurring_task',saved.id,null,
    case when saved.active then 'Recurring task resumed' else 'Recurring task paused' end,jsonb_build_object('active',saved.active));

  return jsonb_build_object('ok',true,'active',saved.active,'error',null);
end; $$;

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
      if not exists (
          select 1
          from recurring_task_instances ri
          join recurring_tasks rt on rt.id=ri.recurring_task_id
          where rt.assigned_to=template.assigned_to
            and lower(rt.title)=lower(template.title)
            and ri.run_date=run_day
        ) then
        insert into tasks(title, details, assigned_to, assigned_by, priority, due_date, recurring_task_id)
        values(template.title, template.details, template.assigned_to, template.assigned_by, template.priority, run_day, template.id)
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
        if not exists (
            select 1
            from recurring_task_instances ri
            join recurring_tasks rt on rt.id=ri.recurring_task_id
            where rt.assigned_to=template.assigned_to
              and lower(rt.title)=lower(template.title)
              and ri.run_date=run_day
          ) then
          insert into tasks(title, details, assigned_to, assigned_by, priority, due_date, template_id, recurring_task_id, estimated_minutes, proof_requirement, checklist)
          values(template.title, template.details, template.assigned_to, template.assigned_by, template.priority, run_day,
            template.template_id, template.id, template.estimated_minutes, template.proof_requirement, template.checklist)
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

grant execute on function can_view_task_template(app_users, task_templates) to anon, authenticated;
grant execute on function can_manage_task_template(app_users, task_templates) to anon, authenticated;
grant execute on function task_template_json(task_templates) to anon, authenticated;
grant execute on function get_task_templates_rpc(text, boolean, int) to anon, authenticated;
grant execute on function upsert_task_template_rpc(text, uuid, text, text, task_priority, text, int, text, jsonb, text) to anon, authenticated;
grant execute on function create_template_from_task_rpc(text, uuid, text) to anon, authenticated;
grant execute on function archive_task_template_rpc(text, uuid, boolean) to anon, authenticated;
grant execute on function assign_task_template_rpc(text, uuid, uuid[], date, text, int[], date, date, time) to anon, authenticated;
grant execute on function set_recurring_task_active_rpc(text, uuid, boolean) to anon, authenticated;

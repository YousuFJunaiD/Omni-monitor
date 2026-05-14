-- Enterprise review workflow for task submissions.
-- Run after round16-task-review-status-values.sql.
-- Adds review actions while preserving existing proof upload and task views.

create table if not exists task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  reviewer_id uuid not null references app_users(id),
  action text not null check (action in ('OPEN_REVIEW','APPROVE','REQUEST_CHANGES','REJECT')),
  comment text default '',
  from_status task_status,
  to_status task_status,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_reviews_task_created on task_reviews(task_id, created_at desc);
create index if not exists idx_tasks_review_status_due on tasks(status, due_date, created_at desc);

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

create or replace function can_review_task(p_reviewer app_users, p_task tasks)
returns boolean language plpgsql stable as $$
declare assignee app_users;
begin
  if p_reviewer.id is null or p_task.id is null then return false; end if;
  if p_reviewer.role = 'CEO' then return true; end if;
  if p_task.assigned_by = p_reviewer.id then return true; end if;
  select * into assignee from app_users where id=p_task.assigned_to;
  return p_reviewer.role in ('BOARD','FOUNDER')
    and assignee.role = 'INTERN'
    and user_department(p_reviewer) <> ''
    and user_department(p_reviewer) = user_department(assignee);
end; $$;

create or replace function can_view_review_task(p_viewer app_users, p_task tasks)
returns boolean language plpgsql stable as $$
begin
  if p_viewer.id is null or p_task.id is null then return false; end if;
  return p_viewer.role = 'CEO'
    or p_task.assigned_to = p_viewer.id
    or can_review_task(p_viewer, p_task);
end; $$;

create or replace function review_task_rpc(p_token text, p_task_id uuid, p_action text, p_comment text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  task_row tasks;
  old_status task_status;
  next_status task_status;
  action_name text := upper(trim(coalesce(p_action,'')));
  review_row task_reviews;
  event_body text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not can_review_task(me, task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed to review this task'); end if;

  old_status := task_row.status;

  if action_name = 'OPEN_REVIEW' then
    next_status := 'UNDER_REVIEW';
    event_body := 'Review opened';
  elsif action_name = 'APPROVE' then
    next_status := 'APPROVED';
    event_body := 'Task approved';
  elsif action_name = 'REQUEST_CHANGES' then
    next_status := 'CHANGES_REQUESTED';
    event_body := 'Changes requested';
  elsif action_name = 'REJECT' then
    next_status := 'REJECTED';
    event_body := 'Task rejected';
  else
    return jsonb_build_object('ok',false,'data',null,'error','Invalid review action');
  end if;

  if action_name = 'OPEN_REVIEW' and old_status not in ('SUBMITTED','RESUBMITTED') then
    return jsonb_build_object('ok',false,'data',null,'error','Task is not waiting for review');
  end if;
  if action_name in ('APPROVE','REQUEST_CHANGES','REJECT') and old_status not in ('SUBMITTED','UNDER_REVIEW','RESUBMITTED') then
    return jsonb_build_object('ok',false,'data',null,'error','Task is not reviewable');
  end if;

  update tasks
  set status=next_status,
      completed_at=case when next_status='APPROVED' then coalesce(completed_at,now()) else completed_at end
  where id=p_task_id
  returning * into task_row;

  insert into task_reviews(task_id, reviewer_id, action, comment, from_status, to_status)
  values(p_task_id, me.id, action_name, trim(coalesce(p_comment,'')), old_status, next_status)
  returning * into review_row;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'TASK_REVIEW','task_reviews',review_row.id,jsonb_build_object('task_id',p_task_id,'action',action_name,'from',old_status,'to',next_status));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,action_name,'task_review',review_row.id,p_task_id,event_body,jsonb_build_object('comment',trim(coalesce(p_comment,'')),'from',old_status,'to',next_status));

  perform round4_notify(p_token,me.id,task_row.assigned_to,'TASK_STATUS_CHANGED',event_body,task_row.title,'task',task_row.id);
  perform round4_notify(p_token,me.id,task_row.assigned_by,'TASK_STATUS_CHANGED',event_body,task_row.title,'task',task_row.id);

  return jsonb_build_object('ok',true,'data',round4_task_json(task_row),'review',jsonb_build_object('id',review_row.id,'action',review_row.action,'comment',review_row.comment,'created_at',review_row.created_at),'error',null);
end; $$;

create or replace function add_log_rpc(p_token text, p_task_id uuid, p_note text, p_minutes int, p_screenshot_data_url text, p_is_submission boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; proof_id uuid; next_status task_status; event_type text; event_body text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if task_row.assigned_to <> me.id and me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','Only assignee can submit logs'); end if;

  if p_minutes > 0 then
    insert into time_logs(task_id,user_id,minutes,note) values(p_task_id,task_row.assigned_to,p_minutes,p_note);
  end if;

  insert into proof_logs(task_id,user_id,note,screenshot_data_url,is_submission)
  values(p_task_id,task_row.assigned_to,p_note,p_screenshot_data_url,p_is_submission)
  returning id into proof_id;

  if p_is_submission then
    next_status := case when task_row.status = 'CHANGES_REQUESTED' then 'RESUBMITTED' else 'SUBMITTED' end;
    event_type := case when task_row.status = 'CHANGES_REQUESTED' then 'RESUBMITTED' else 'PROOF_SUBMITTED' end;
    event_body := case when task_row.status = 'CHANGES_REQUESTED' then 'Task resubmitted' else 'Proof submitted' end;

    update tasks set status=next_status where id=p_task_id and status not in ('DONE','APPROVED','REJECTED');

    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,event_type,'proof',proof_id,p_task_id,event_body,jsonb_build_object('minutes',p_minutes,'is_submission',p_is_submission,'from',task_row.status,'to',next_status));
    perform round4_notify(p_token,me.id,task_row.assigned_by,'PROOF_SUBMITTED',event_body,task_row.title,'proof',proof_id);
  end if;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,case when p_is_submission then 'SUBMIT_WORK' else 'ADD_LOG' end,'proof_logs',proof_id,jsonb_build_object('task_id',p_task_id,'minutes',p_minutes));

  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',proof_id,'task_id',p_task_id),'error',null,'id',proof_id);
end; $$;

create or replace function update_task_status_rpc(p_token text, p_task_id uuid, p_status task_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; updated_task tasks; old_status task_status;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;

  if me.role <> 'CEO' and task_row.assigned_to <> me.id then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed');
  end if;

  if me.role <> 'CEO' then
    if p_status in ('UNDER_REVIEW','APPROVED','CHANGES_REQUESTED','REJECTED') then
      return jsonb_build_object('ok',false,'data',null,'error','Reviewer status is restricted');
    end if;
    if p_status = 'DONE' and task_row.status <> 'APPROVED' then
      return jsonb_build_object('ok',false,'data',null,'error','Task must be approved before marking done');
    end if;
    if p_status = 'RESUBMITTED' then
      return jsonb_build_object('ok',false,'data',null,'error','Resubmit proof to resubmit the task');
    end if;
  end if;

  old_status := task_row.status;

  update tasks
  set status=p_status,
      completed_at=case when p_status in ('DONE','APPROVED') then coalesce(completed_at,now()) else completed_at end
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_STATUS','tasks',p_task_id,jsonb_build_object('from',old_status,'to',p_status));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'STATUS_CHANGED','task',p_task_id,p_task_id,'Task status changed',jsonb_build_object('from',old_status,'to',p_status));

  if p_status='DONE' and old_status is distinct from p_status then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_COMPLETED','task',p_task_id,p_task_id,'Task completed',jsonb_build_object('from',old_status,'to',p_status));
  end if;

  perform round4_notify(p_token,me.id,updated_task.assigned_to,'TASK_STATUS_CHANGED','Task status changed',updated_task.title || ' is now ' || p_status::text,'task',updated_task.id);
  perform round4_notify(p_token,me.id,updated_task.assigned_by,'TASK_STATUS_CHANGED',case when p_status='DONE' then 'Task completed' else 'Task status changed' end,updated_task.title || ' is now ' || p_status::text,'task',updated_task.id);

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

create or replace function get_task_by_id_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; comments_payload jsonb; proofs_payload jsonb; reviews_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not can_view_review_task(me, task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

  select jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'user_id',c.user_id,'user_name',u.name,'user_role',u.role,'body',c.body,'created_at',c.created_at) order by c.created_at asc)
  into comments_payload
  from task_comments c join app_users u on u.id=c.user_id
  where c.task_id=p_task_id;

  select jsonb_agg(jsonb_build_object('id',p.id,'task_id',p.task_id,'user_id',p.user_id,'user_name',u.name,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) order by p.created_at desc)
  into proofs_payload
  from proof_logs p join app_users u on u.id=p.user_id
  where p.task_id=p_task_id;

  select jsonb_agg(jsonb_build_object('id',r.id,'task_id',r.task_id,'reviewer_id',r.reviewer_id,'reviewer_name',u.name,'action',r.action,'comment',r.comment,'from_status',r.from_status,'to_status',r.to_status,'created_at',r.created_at) order by r.created_at desc)
  into reviews_payload
  from task_reviews r join app_users u on u.id=r.reviewer_id
  where r.task_id=p_task_id;

  return jsonb_build_object('ok',true,'data',round4_task_json(task_row) || jsonb_build_object('comments',coalesce(comments_payload,'[]'::jsonb),'proofs',coalesce(proofs_payload,'[]'::jsonb),'reviews',coalesce(reviews_payload,'[]'::jsonb)),'error',null);
end; $$;

grant execute on function can_review_task(app_users, tasks) to anon, authenticated;
grant execute on function can_view_review_task(app_users, tasks) to anon, authenticated;
grant execute on function review_task_rpc(text, uuid, text, text) to anon, authenticated;
grant execute on function add_log_rpc(text, uuid, text, int, text, boolean) to anon, authenticated;
grant execute on function update_task_status_rpc(text, uuid, task_status) to anon, authenticated;
grant execute on function get_task_by_id_rpc(text, uuid) to anon, authenticated;

create or replace function get_tasks_by_view_rpc(
  p_token text,
  p_view text default 'today',
  p_limit int default 80,
  p_offset int default 0
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  view_name text := coalesce(nullif(lower(p_view),''),'today');
  take_count int := least(greatest(coalesce(p_limit,80),1),200);
  skip_count int := greatest(coalesce(p_offset,0),0);
  payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if view_name not in ('today','overdue','review','history') then view_name := 'today'; end if;

  with visible_tasks as (
    select t.id,t.title,t.details,t.status,t.priority,t.due_date,t.created_at,t.completed_at,t.assigned_to,t.assigned_by,
      u.name assigned_to_name,u.role assignee_role,u.title assignee_title,u.username assignee_username,
      ab.name assigned_by_name,ab.role assigned_by_role
    from tasks t
    join app_users u on u.id=t.assigned_to
    left join app_users ab on ab.id=t.assigned_by
    where me.role='CEO'
      or t.assigned_to=me.id
      or can_review_task(me,t)
  ),
  filtered_tasks as (
    select * from visible_tasks
    where
      (view_name='today' and status not in ('DONE','APPROVED','REJECTED','SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED') and (due_date=current_date or due_date is null or due_date > current_date))
      or (view_name='overdue' and due_date < current_date and status not in ('DONE','APPROVED','REJECTED'))
      or (view_name='review' and status in ('SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED'))
      or (view_name='history' and status in ('DONE','APPROVED','REJECTED'))
  ),
  counts as (
    select
      count(*) filter(where status not in ('DONE','APPROVED','REJECTED','SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED') and (due_date=current_date or due_date is null or due_date > current_date))::int today,
      count(*) filter(where due_date < current_date and status not in ('DONE','APPROVED','REJECTED'))::int overdue,
      count(*) filter(where status in ('SUBMITTED','UNDER_REVIEW','RESUBMITTED','CHANGES_REQUESTED'))::int review,
      count(*) filter(where status in ('DONE','APPROVED','REJECTED'))::int history
    from visible_tasks
  ),
  selected_tasks as (
    select * from filtered_tasks
    order by case when view_name='overdue' then due_date end asc,
      case when view_name='today' then due_date end asc nulls last,
      created_at desc
    limit take_count offset skip_count
  ),
  minutes_by_task as (
    select tl.task_id, sum(tl.minutes)::int minutes_logged from time_logs tl join selected_tasks st on st.id=tl.task_id group by tl.task_id
  ),
  proof_stats as (
    select p.task_id, count(*)::int proof_count, max(p.created_at) last_proof_at from proof_logs p join selected_tasks st on st.id=p.task_id group by p.task_id
  ),
  task_items as (
    select jsonb_agg(jsonb_build_object(
      'id',st.id,'title',st.title,'details',st.details,'status',st.status,'priority',st.priority,'due_date',st.due_date,'created_at',st.created_at,'completed_at',st.completed_at,
      'assigned_to_id',st.assigned_to,'assigned_to_name',st.assigned_to_name,'assigned_to',st.assigned_to_name,
      'assignee_role',st.assignee_role,'assignee_title',st.assignee_title,'assignee_username',st.assignee_username,
      'assigned_by_id',st.assigned_by,'assigned_by_name',st.assigned_by_name,'assigned_by_role',st.assigned_by_role,
      'minutes_logged',coalesce(mbt.minutes_logged,0),'minutes',coalesce(mbt.minutes_logged,0),'proof_count',coalesce(ps.proof_count,0),'last_proof_at',ps.last_proof_at
    ) order by case when view_name='overdue' then st.due_date end asc, case when view_name='today' then st.due_date end asc nulls last, st.created_at desc) tasks
    from selected_tasks st
    left join minutes_by_task mbt on mbt.task_id=st.id
    left join proof_stats ps on ps.task_id=st.id
  )
  select jsonb_build_object(
    'ok',true,'view',view_name,'limit',take_count,'offset',skip_count,
    'counts',jsonb_build_object('today',c.today,'overdue',c.overdue,'review',c.review,'history',c.history),
    'tasks',coalesce(ti.tasks,'[]'::jsonb)
  )
  into payload
  from counts c cross join task_items ti;

  return coalesce(payload,jsonb_build_object('ok',true,'view',view_name,'limit',take_count,'offset',skip_count,'counts',jsonb_build_object('today',0,'overdue',0,'review',0,'history',0),'tasks','[]'::jsonb));
end; $$;

create or replace function get_tasks_rpc(p_token text, p_view text default 'today', p_limit int default 80, p_offset int default 0)
returns jsonb language sql security definer set search_path=public as $$
  select get_tasks_by_view_rpc(p_token, p_view, p_limit, p_offset);
$$;

grant execute on function get_tasks_by_view_rpc(text, text, int, int) to anon, authenticated;
grant execute on function get_tasks_rpc(text, text, int, int) to anon, authenticated;

-- Department-based assignment and management RBAC.
-- Frontend managers: CPO/CXO -> frontend interns.
-- Backend managers: CTO/CSA -> backend interns.

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

create or replace function can_view_department_task(p_viewer app_users, p_task tasks)
returns boolean language plpgsql stable as $$
declare assignee app_users;
begin
  if p_viewer.id is null or p_task.id is null then return false; end if;
  if p_viewer.role = 'CEO' then return true; end if;
  if p_task.assigned_to = p_viewer.id then return true; end if;
  select * into assignee from app_users where id = p_task.assigned_to;
  return p_viewer.role in ('BOARD','FOUNDER')
    and assignee.role = 'INTERN'
    and user_department(p_viewer) <> ''
    and user_department(p_viewer) = user_department(assignee);
end; $$;

create or replace function create_task_rpc(p_token text, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; new_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Task title is required'); end if;
  if not can_assign_department_task(me, target_user) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed to assign this user');
  end if;

  insert into tasks(title, details, assigned_to, assigned_by, priority, due_date)
  values(trim(p_title),coalesce(p_details,''),p_assigned_to,me.id,p_priority,p_due_date)
  returning * into new_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'CREATE_TASK','tasks',new_task.id,jsonb_build_object('assigned_to',p_assigned_to,'department',user_department(target_user)));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_CREATED','task',new_task.id,new_task.id,'Task created',jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date,'department',user_department(target_user)));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_ASSIGNED','task',new_task.id,new_task.id,'Task assigned',jsonb_build_object('assigned_to',p_assigned_to,'department',user_department(target_user)));

  perform round4_notify(p_token,me.id,p_assigned_to,'TASK_ASSIGNED','New task assigned',new_task.title,'task',new_task.id);
  return jsonb_build_object('ok',true,'data',round4_task_json(new_task),'error',null,'id',new_task.id);
end; $$;

create or replace function update_task_rpc(p_token text, p_task_id uuid, p_title text, p_details text, p_assigned_to uuid, p_priority task_priority, p_due_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; old_assigned_to uuid; target_user app_users; updated_task tasks;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not round4_can_manage_task(me,task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;
  if length(trim(coalesce(p_title,''))) < 1 then return jsonb_build_object('ok',false,'data',null,'error','Task title is required'); end if;

  select * into target_user from app_users where id=p_assigned_to and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Invalid assignee'); end if;
  if not can_assign_department_task(me, target_user) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed to assign this user');
  end if;

  old_assigned_to := task_row.assigned_to;
  update tasks
  set title=trim(p_title), details=coalesce(p_details,''), assigned_to=p_assigned_to, priority=p_priority, due_date=p_due_date
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date,'department',user_department(target_user)));

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,'TASK_UPDATED','task',p_task_id,p_task_id,'Task updated',jsonb_build_object('assigned_to',p_assigned_to,'priority',p_priority,'due_date',p_due_date,'department',user_department(target_user)));

  if old_assigned_to is distinct from p_assigned_to then
    insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
    values(me.id,'TASK_ASSIGNED','task',p_task_id,p_task_id,'Task reassigned',jsonb_build_object('from',old_assigned_to,'to',p_assigned_to,'department',user_department(target_user)));
    perform round4_notify(p_token,me.id,p_assigned_to,'TASK_ASSIGNED','Task assigned to you',updated_task.title,'task',updated_task.id);
  end if;

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

create or replace function get_task_by_id_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; comments_payload jsonb; proofs_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;
  if not can_view_department_task(me, task_row) then return jsonb_build_object('ok',false,'data',null,'error','Not allowed'); end if;

  select jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'user_id',c.user_id,'user_name',u.name,'user_role',u.role,'body',c.body,'created_at',c.created_at) order by c.created_at asc)
  into comments_payload
  from task_comments c join app_users u on u.id=c.user_id
  where c.task_id=p_task_id;

  select jsonb_agg(jsonb_build_object('id',p.id,'task_id',p.task_id,'user_id',p.user_id,'user_name',u.name,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) order by p.created_at desc)
  into proofs_payload
  from proof_logs p join app_users u on u.id=p.user_id
  where p.task_id=p_task_id;

  return jsonb_build_object('ok',true,'data',round4_task_json(task_row) || jsonb_build_object('comments',coalesce(comments_payload,'[]'::jsonb),'proofs',coalesce(proofs_payload,'[]'::jsonb)),'error',null);
end; $$;

create or replace function get_tasks_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; tasks_payload jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select jsonb_agg(jsonb_build_object(
    'id',t.id,'title',t.title,'details',t.details,'status',t.status,'priority',t.priority,'due_date',t.due_date,'strike_applied',t.strike_applied,
    'assigned_to',u.name,'assigned_to_id',u.id,'assignee_role',u.role,'assignee_title',u.title,'assignee_username',u.username,'assignee_avatar_data_url',u.avatar_data_url,
    'assigned_by_id',ab.id,'assigned_by_name',ab.name,'assigned_by_role',ab.role,'assigner_avatar_data_url',ab.avatar_data_url,
    'created_at',t.created_at,'completed_at',t.completed_at,'minutes',coalesce((select sum(minutes) from time_logs where task_id=t.id),0),
    'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'note',p.note,'is_submission',p.is_submission,'created_at',p.created_at,'screenshot_data_url',p.screenshot_data_url) order by p.created_at desc) from proof_logs p where p.task_id=t.id),'[]'::jsonb)
  ) order by t.created_at desc) into tasks_payload
  from tasks t
  join app_users u on u.id=t.assigned_to
  left join app_users ab on ab.id=t.assigned_by
  where can_view_department_task(me, t);

  return jsonb_build_object('ok',true,'tasks',coalesce(tasks_payload,'[]'::jsonb));
end; $$;

create or replace function get_dashboard_v2(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; visible_users jsonb; founder_ranking jsonb; intern_ranking jsonb; proof_feed jsonb; ideas_payload jsonb;
  attention_overdue jsonb; attention_needs_review jsonb; attention_blocked jsonb; recent_activity jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'role',u.role,'title',u.title,'strikes',u.strikes,'avatar_data_url',u.avatar_data_url) order by u.name) into visible_users
  from app_users u
  where u.active=true and (me.role='CEO' or u.id=me.id or can_assign_department_task(me,u));

  select jsonb_agg(row_to_json(x) order by x.score desc, x.name) into founder_ranking
  from (
    select row_number() over(order by ((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*25)) desc,u.name) rank,
      u.id,u.name,u.title,u.role,u.strikes,((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*25))::int score,
      coalesce(tc.done,0)::int done,coalesce(tc.total,0)::int total
    from app_users u
    left join (select assigned_to,count(*)::int total,count(*) filter(where status='DONE')::int done from tasks group by assigned_to) tc on tc.assigned_to=u.id
    left join (select user_id,count(*) filter(where is_submission=true)::int submissions from proof_logs group by user_id) pc on pc.user_id=u.id
    where u.active=true and u.role='FOUNDER' and (me.role='CEO' or u.id=me.id)
    order by score desc,u.name limit case when me.role='CEO' then 20 else 1 end
  ) x;

  select jsonb_agg(row_to_json(x) order by x.score desc, x.name) into intern_ranking
  from (
    select row_number() over(order by ((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*25)) desc,u.name) rank,
      u.id,u.name,u.title,u.role,u.strikes,((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*25))::int score,
      coalesce(tc.done,0)::int done,coalesce(tc.total,0)::int total
    from app_users u
    left join (select assigned_to,count(*)::int total,count(*) filter(where status='DONE')::int done from tasks group by assigned_to) tc on tc.assigned_to=u.id
    left join (select user_id,count(*) filter(where is_submission=true)::int submissions from proof_logs group by user_id) pc on pc.user_id=u.id
    where u.active=true and u.role='INTERN' and (me.role='CEO' or u.id=me.id or can_assign_department_task(me,u))
    order by score desc,u.name limit case when me.role='CEO' then 20 when me.role in ('BOARD','FOUNDER') then 20 else 1 end
  ) x;

  select jsonb_agg(feed.item order by feed.created_at desc) into proof_feed
  from (
    select jsonb_build_object('id',p.id,'task_id',p.task_id,'task_title',t.title,'user',u.name,'avatar_data_url',u.avatar_data_url,'note',p.note,'is_submission',p.is_submission,'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at) item,p.created_at
    from proof_logs p join tasks t on t.id=p.task_id join app_users u on u.id=p.user_id
    where can_view_department_task(me,t)
    order by p.created_at desc limit 10
  ) feed;

  select jsonb_agg(idea.item order by idea.created_at desc) into ideas_payload
  from (
    select jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'status',i.status,'submitted_by_id',su.id,'submitted_by_name',su.name,'submitted_by_role',su.role,'avatar_data_url',su.avatar_data_url,'decision_by_id',du.id,'decision_by_name',du.name,'decision_note',i.decision_note,'created_at',i.created_at,'updated_at',i.updated_at,'decided_at',i.decided_at) item,i.created_at
    from ideas i join app_users su on su.id=i.submitted_by left join app_users du on du.id=i.decision_by
    where me.role in ('CEO','BOARD') or (me.role='FOUNDER' and (i.submitted_by=me.id or i.status in ('APPROVED','IN_PROGRESS'))) or (me.role='INTERN' and i.submitted_by=me.id)
    order by i.created_at desc limit 50
  ) idea;

  select jsonb_agg(q.item order by q.due_date asc) into attention_overdue
  from (
    select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,'assigned_by_id',ab.id,'assigned_by_name',ab.name) item,t.due_date
    from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
    where t.due_date < current_date and t.status <> 'DONE' and can_view_department_task(me,t)
    order by t.due_date asc limit 10
  ) q;

  select jsonb_agg(q.item order by q.created_at desc) into attention_needs_review
  from (
    select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,'assigned_by_id',ab.id,'assigned_by_name',ab.name) item,t.created_at
    from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
    where t.status='SUBMITTED' and can_view_department_task(me,t)
    order by t.created_at desc limit 10
  ) q;

  select jsonb_agg(q.item order by q.due_date asc) into attention_blocked
  from (
    select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,'assigned_by_id',ab.id,'assigned_by_name',ab.name) item,t.due_date
    from tasks t join app_users u on u.id=t.assigned_to left join app_users ab on ab.id=t.assigned_by
    where t.status='BLOCKED' and can_view_department_task(me,t)
    order by t.due_date asc limit 10
  ) q;

  select jsonb_agg(row_to_json(x) order by x.created_at desc) into recent_activity
  from (
    select e.id,e.event_type,e.body,e.meta,e.created_at,a.name actor_name,a.role actor_role,t.id task_id,t.title task_title,u.name assignee_name
    from activity_events e left join app_users a on a.id=e.actor_id left join tasks t on t.id=e.task_id left join app_users u on u.id=t.assigned_to
    where me.role='CEO' or e.actor_id=me.id or (t.id is not null and can_view_department_task(me,t))
    order by e.created_at desc limit 20
  ) x;

  return jsonb_build_object('ok',true,
    'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes,'avatar_data_url',me.avatar_data_url),
    'visible_users',coalesce(visible_users,'[]'::jsonb),'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),'proof_feed',coalesce(proof_feed,'[]'::jsonb),'ideas',coalesce(ideas_payload,'[]'::jsonb),
    'attention_overdue',coalesce(attention_overdue,'[]'::jsonb),'attention_needs_review',coalesce(attention_needs_review,'[]'::jsonb),'attention_blocked',coalesce(attention_blocked,'[]'::jsonb),'recent_activity',coalesce(recent_activity,'[]'::jsonb),
    'unread_notifications',(select count(*)::int from notifications where user_id=me.id and read_at is null and dismissed_at is null)
  );
end; $$;

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return get_dashboard_v2(p_token);
end; $$;

grant execute on function user_department(app_users) to anon, authenticated;
grant execute on function can_assign_department_task(app_users, app_users) to anon, authenticated;
grant execute on function can_view_department_task(app_users, tasks) to anon, authenticated;
grant execute on function create_task_rpc(text, text, text, uuid, task_priority, date) to anon, authenticated;
grant execute on function update_task_rpc(text, uuid, text, text, uuid, task_priority, date) to anon, authenticated;
grant execute on function get_task_by_id_rpc(text, uuid) to anon, authenticated;
grant execute on function get_tasks_rpc(text) to anon, authenticated;
grant execute on function get_dashboard_v2(text) to anon, authenticated;
grant execute on function get_dashboard(text) to anon, authenticated;

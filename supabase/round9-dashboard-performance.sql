-- Dashboard hotfix: bounded dashboard RPCs and supporting indexes.
-- Root cause: get_dashboard -> get_dashboard_v2 was doing automatic strike
-- calculation, unbounded joins, and repeated score_for_user() ranking calls.

create index if not exists idx_tasks_assigned_to on tasks(assigned_to);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_due_date on tasks(due_date);
create index if not exists idx_tasks_assigned_by on tasks(assigned_by);
create index if not exists idx_tasks_status_due_date on tasks(status, due_date);
create index if not exists idx_proof_logs_user_id on proof_logs(user_id);
create index if not exists idx_proof_logs_created_at on proof_logs(created_at desc);
create index if not exists idx_proof_logs_task_created_at on proof_logs(task_id, created_at desc);
create index if not exists idx_activity_events_created_at on activity_events(created_at desc);
create index if not exists idx_activity_events_task_created_at on activity_events(task_id, created_at desc);
create index if not exists idx_app_sessions_token on app_sessions(token);
create index if not exists idx_notifications_user_unread on notifications(user_id, read_at, dismissed_at);

create or replace function get_dashboard_v2(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  visible_users jsonb;
  founder_ranking jsonb;
  intern_ranking jsonb;
  proof_feed jsonb;
  ideas_payload jsonb;
  attention_overdue jsonb;
  attention_needs_review jsonb;
  attention_blocked jsonb;
  recent_activity jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  -- Important: do not run apply_strikes() during dashboard load.
  select * into me from app_users where id=me.id;

  select jsonb_agg(jsonb_build_object(
    'id',u.id,'name',u.name,'username',u.username,'role',u.role,'title',u.title,
    'strikes',u.strikes,'avatar_data_url',u.avatar_data_url
  ) order by u.name) into visible_users
  from app_users u
  where u.active=true and (
    me.role='CEO'
    or u.id=me.id
    or (
      me.role in ('BOARD','FOUNDER')
      and u.role='INTERN'
      and exists (
        select 1 from tasks t
        where t.assigned_to=u.id and t.assigned_by=me.id
        limit 1
      )
    )
  );

  select jsonb_agg(row_to_json(x) order by x.score desc, x.name) into founder_ranking
  from (
    select
      row_number() over(order by ((coalesce(tc.done,0) * 10) + (coalesce(pc.submissions,0) * 15) - (coalesce(u.strikes,0) * 25)) desc, u.name) as rank,
      u.id,u.name,u.title,u.role,u.strikes,
      ((coalesce(tc.done,0) * 10) + (coalesce(pc.submissions,0) * 15) - (coalesce(u.strikes,0) * 25))::int as score,
      coalesce(tc.done,0)::int as done,
      coalesce(tc.total,0)::int as total
    from app_users u
    left join (
      select assigned_to, count(*)::int total, count(*) filter (where status='DONE')::int done
      from tasks group by assigned_to
    ) tc on tc.assigned_to=u.id
    left join (
      select user_id, count(*) filter (where is_submission=true)::int submissions
      from proof_logs group by user_id
    ) pc on pc.user_id=u.id
    where u.active=true and u.role='FOUNDER' and (me.role='CEO' or u.id=me.id)
    order by score desc, u.name
    limit case when me.role='CEO' then 20 else 1 end
  ) x;

  select jsonb_agg(row_to_json(x) order by x.score desc, x.name) into intern_ranking
  from (
    select
      row_number() over(order by ((coalesce(tc.done,0) * 10) + (coalesce(pc.submissions,0) * 15) - (coalesce(u.strikes,0) * 25)) desc, u.name) as rank,
      u.id,u.name,u.title,u.role,u.strikes,
      ((coalesce(tc.done,0) * 10) + (coalesce(pc.submissions,0) * 15) - (coalesce(u.strikes,0) * 25))::int as score,
      coalesce(tc.done,0)::int as done,
      coalesce(tc.total,0)::int as total
    from app_users u
    left join (
      select assigned_to, count(*)::int total, count(*) filter (where status='DONE')::int done
      from tasks group by assigned_to
    ) tc on tc.assigned_to=u.id
    left join (
      select user_id, count(*) filter (where is_submission=true)::int submissions
      from proof_logs group by user_id
    ) pc on pc.user_id=u.id
    where u.active=true and u.role='INTERN'
      and (
        me.role='CEO'
        or u.id=me.id
        or (
          me.role in ('BOARD','FOUNDER')
          and exists (
            select 1 from tasks t
            where t.assigned_to=u.id and t.assigned_by=me.id
            limit 1
          )
        )
      )
    order by score desc, u.name
    limit case when me.role='CEO' then 20 when me.role in ('BOARD','FOUNDER') then 20 else 1 end
  ) x;

  select jsonb_agg(feed.item order by feed.created_at desc) into proof_feed
  from (
    select jsonb_build_object(
      'id',p.id,'task_id',p.task_id,'task_title',t.title,'user',u.name,
      'avatar_data_url',u.avatar_data_url,'note',p.note,'is_submission',p.is_submission,
      'screenshot_data_url',p.screenshot_data_url,'created_at',p.created_at
    ) item, p.created_at
    from proof_logs p
    join tasks t on t.id=p.task_id
    join app_users u on u.id=p.user_id
    where me.role='CEO'
      or p.user_id=me.id
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id)
    order by p.created_at desc
    limit 10
  ) feed;

  select jsonb_agg(idea.item order by idea.created_at desc) into ideas_payload
  from (
    select jsonb_build_object(
      'id',i.id,'title',i.title,'description',i.description,'status',i.status,
      'submitted_by_id',su.id,'submitted_by_name',su.name,'submitted_by_role',su.role,
      'avatar_data_url',su.avatar_data_url,'decision_by_id',du.id,'decision_by_name',du.name,
      'decision_note',i.decision_note,'created_at',i.created_at,'updated_at',i.updated_at,'decided_at',i.decided_at
    ) item, i.created_at
    from ideas i
    join app_users su on su.id=i.submitted_by
    left join app_users du on du.id=i.decision_by
    where me.role in ('CEO','BOARD')
      or (me.role='FOUNDER' and (i.submitted_by=me.id or i.status in ('APPROVED','IN_PROGRESS')))
      or (me.role='INTERN' and i.submitted_by=me.id)
    order by i.created_at desc
    limit 50
  ) idea;

  select jsonb_agg(q.item order by q.due_date asc) into attention_overdue
  from (
    select jsonb_build_object(
      'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
      'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
      'assigned_by_id',ab.id,'assigned_by_name',ab.name
    ) item, t.due_date
    from tasks t
    join app_users u on u.id=t.assigned_to
    left join app_users ab on ab.id=t.assigned_by
    where t.due_date < current_date and t.status <> 'DONE'
      and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id))
    order by t.due_date asc
    limit 10
  ) q;

  select jsonb_agg(q.item order by q.created_at desc) into attention_needs_review
  from (
    select jsonb_build_object(
      'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
      'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
      'assigned_by_id',ab.id,'assigned_by_name',ab.name
    ) item, t.created_at
    from tasks t
    join app_users u on u.id=t.assigned_to
    left join app_users ab on ab.id=t.assigned_by
    where t.status='SUBMITTED'
      and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id))
    order by t.created_at desc
    limit 10
  ) q;

  select jsonb_agg(q.item order by q.due_date asc) into attention_blocked
  from (
    select jsonb_build_object(
      'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'due_date',t.due_date,
      'assigned_to_id',u.id,'assigned_to_name',u.name,'assigned_to_role',u.role,
      'assigned_by_id',ab.id,'assigned_by_name',ab.name
    ) item, t.due_date
    from tasks t
    join app_users u on u.id=t.assigned_to
    left join app_users ab on ab.id=t.assigned_by
    where t.status='BLOCKED'
      and (me.role='CEO' or t.assigned_to=me.id or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id))
    order by t.due_date asc
    limit 10
  ) q;

  select jsonb_agg(row_to_json(x) order by x.created_at desc) into recent_activity
  from (
    select e.id,e.event_type,e.body,e.meta,e.created_at,
      a.name actor_name,a.role actor_role,
      t.id task_id,t.title task_title,
      u.name assignee_name
    from activity_events e
    left join app_users a on a.id=e.actor_id
    left join tasks t on t.id=e.task_id
    left join app_users u on u.id=t.assigned_to
    where me.role='CEO'
      or e.actor_id=me.id
      or t.assigned_to=me.id
      or (me.role in ('BOARD','FOUNDER') and u.role='INTERN' and t.assigned_by=me.id)
    order by e.created_at desc
    limit 20
  ) x;

  return jsonb_build_object('ok',true,
    'me',jsonb_build_object('id',me.id,'name',me.name,'username',me.username,'role',me.role,'title',me.title,'strikes',me.strikes,'avatar_data_url',me.avatar_data_url),
    'visible_users',coalesce(visible_users,'[]'::jsonb),
    'founder_ranking',coalesce(founder_ranking,'[]'::jsonb),
    'intern_ranking',coalesce(intern_ranking,'[]'::jsonb),
    'proof_feed',coalesce(proof_feed,'[]'::jsonb),
    'ideas',coalesce(ideas_payload,'[]'::jsonb),
    'attention_overdue',coalesce(attention_overdue,'[]'::jsonb),
    'attention_needs_review',coalesce(attention_needs_review,'[]'::jsonb),
    'attention_blocked',coalesce(attention_blocked,'[]'::jsonb),
    'recent_activity',coalesce(recent_activity,'[]'::jsonb),
    'unread_notifications',(select count(*)::int from notifications where user_id=me.id and read_at is null and dismissed_at is null)
  );
end; $$;

create or replace function get_dashboard(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return get_dashboard_v2(p_token);
end; $$;

grant execute on function get_dashboard_v2(text) to anon, authenticated;
grant execute on function get_dashboard(text) to anon, authenticated;

-- Phase 15: strike penalty uplift.
--
-- Each strike now subtracts 70 points (was 25). Three functions are
-- redefined IDENTICALLY to their previous bodies except for the strike
-- multiplier:
--
--   • score_for_user            — central per-user score function
--   • get_dashboard_v2          — inline founder + intern rankings on /home
--   • get_rankings_rpc          — full rankings on /team and in reports
--
-- Function bodies are otherwise byte-for-byte identical to their last
-- definitions. The only edit is `*25` → `*70` in the strike-penalty term.
-- All other scoring weights (task completion, submissions, time, overdue,
-- blocked, consistency, etc.) are UNCHANGED.
--
-- Effect: if a user has 10 strikes, their score drops by 700 points from
-- strike penalty alone (was 250).
--
-- Idempotent. Safe to re-run.

-- ─── score_for_user ──────────────────────────────────────────────────────────────
create or replace function score_for_user(p_user uuid)
returns int language sql security definer set search_path=public as $$
  select coalesce(sum(case when t.status='DONE' then 60 when t.status='SUBMITTED' then 35 when t.status='IN_PROGRESS' then 10 else 0 end),0)::int
       + coalesce((select sum(minutes)/10 from time_logs where user_id=p_user),0)::int
       + coalesce((select count(*)*15 from proof_logs where user_id=p_user and is_submission=true),0)::int
       - coalesce((select strikes * 70 from app_users where id=p_user),0)::int
  from tasks t where t.assigned_to=p_user;
$$;

-- ─── get_dashboard_v2 ──────────────────────────────────────────────────────────────
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
    select row_number() over(order by ((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*70)) desc,u.name) rank,
      u.id,u.name,u.title,u.role,u.strikes,((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*70))::int score,
      coalesce(tc.done,0)::int done,coalesce(tc.total,0)::int total
    from app_users u
    left join (select assigned_to,count(*)::int total,count(*) filter(where status='DONE')::int done from tasks group by assigned_to) tc on tc.assigned_to=u.id
    left join (select user_id,count(*) filter(where is_submission=true)::int submissions from proof_logs group by user_id) pc on pc.user_id=u.id
    where u.active=true and u.role='FOUNDER' and (me.role='CEO' or u.id=me.id)
    order by score desc,u.name limit case when me.role='CEO' then 20 else 1 end
  ) x;

  select jsonb_agg(row_to_json(x) order by x.score desc, x.name) into intern_ranking
  from (
    select row_number() over(order by ((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*70)) desc,u.name) rank,
      u.id,u.name,u.title,u.role,u.strikes,((coalesce(tc.done,0)*10)+(coalesce(pc.submissions,0)*15)-(coalesce(u.strikes,0)*70))::int score,
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

-- ─── get_rankings_rpc ──────────────────────────────────────────────────────────────
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
        - coalesce(u.strikes,0) * 70
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
      (coalesce(ts.done,0)*12 + coalesce(ps.submissions,0)*8 + coalesce(ts.priority_points,0) + coalesce(ts.consistency_days,0)*3 + least(coalesce(ast.recent_activity,0),20) - coalesce(ts.overdue,0)*15 - coalesce(u.strikes,0)*70)::int score
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

-- End of round 26.

-- Bug fix: generate_rule_insights — extract(days from date - date) is invalid.
--
-- Symptom:
--   When a CEO clicks "Generate Weekly Report" (or any rule-based template),
--   PostgreSQL emits:
--     ERROR: function pg_catalog.extract(unknown, integer) does not exist
--   The error fires inside generate_ai_report_rpc (round20) which internally
--   calls generate_rule_insights, where the Deadline Miss block computes
--   `extract(days from (t.completed_at::date - t.due_date))`.
--
-- Root cause:
--   `date - date` returns INTEGER (number of days), not an INTERVAL.
--   `extract(<field> from <integer>)` does not exist in PostgreSQL — extract
--   only accepts timestamp, interval, etc. The same expression with
--   `now() - timestamptz` works because that subtraction yields INTERVAL.
--
-- Fix:
--   Replace `extract(days from (t.completed_at::date - t.due_date))` with
--   the bare subtraction `(t.completed_at::date - t.due_date)`, which already
--   IS an integer number of days. All other extract() uses in this function
--   operate on `now() - timestamp` (interval) and are correct as-is.
--
-- Function body otherwise byte-identical to round20:139–352. Idempotent.

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
      from tasks t join app_users u on u.id = t.assigned_to
      where t.status <> 'DONE'
        and t.due_date < current_date
        and (p_target_user_id is null or t.assigned_to = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
      order by t.due_date asc, greatest(0, current_date - t.due_date) desc
      limit 20
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type', 'task_risk',
        'severity', case when row_data.days_overdue > 7 then 5 when row_data.days_overdue > 3 then 4 when row_data.days_overdue > 1 then 3 else 2 end,
        'title', 'Overdue task: ' || row_data.title,
        'description', row_data.user_name || '''s task "' || row_data.title || '" is ' || row_data.days_overdue || ' day(s) overdue.',
        'suggested_action', 'Follow up with ' || row_data.user_name || ' to assess blockers and get new ETA.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
        'task_id', row_data.id,
        'metadata', jsonb_build_object('days_overdue', row_data.days_overdue, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Deadline Miss: tasks completed late.
  -- FIX (round25): date - date is already an integer. Do NOT wrap in extract().
  if p_template_key in ('weekly_company','monthly_company') then
    for row_data in
      select t.id, t.title, t.due_date, t.completed_at, u.id as user_id, u.name as user_name, user_department(u) as dept,
        greatest(0, (t.completed_at::date - t.due_date)) as days_late
      from tasks t join app_users u on u.id = t.assigned_to
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
        'insight_type', 'deadline_miss',
        'severity', case when row_data.days_late > 5 then 4 when row_data.days_late > 2 then 3 else 2 end,
        'title', 'Missed deadline: ' || row_data.title,
        'description', row_data.user_name || ' completed "' || row_data.title || '" ' || row_data.days_late || ' day(s) late.',
        'suggested_action', 'Review task complexity with ' || row_data.user_name || '. Consider clearer scope or deadline adjustments.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
        'task_id', row_data.id,
        'metadata', jsonb_build_object('days_late', row_data.days_late, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Inactivity: no task updates in 7+ days. (now() - timestamp returns INTERVAL, extract(days) is valid.)
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select u.id as user_id, u.name as user_name, user_department(u) as dept,
        greatest(0, extract(days from (now() - coalesce(
          (select max(created_at) from activity_events where target_kind = 'task' and target_id in (select id from tasks where assigned_to = u.id)),
          u.created_at
        )))) as days_inactive
      from app_users u
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and (p_target_user_id is null or u.id = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
        and greatest(0, extract(days from (now() - coalesce(
          (select max(created_at) from activity_events where target_kind = 'task' and target_id in (select id from tasks where assigned_to = u.id)),
          u.created_at
        )))) >= 7
      order by days_inactive desc
      limit 10
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type', 'inactivity',
        'severity', case when row_data.days_inactive > 14 then 4 when row_data.days_inactive > 7 then 3 else 2 end,
        'title', 'Inactive member: ' || row_data.user_name,
        'description', row_data.user_name || ' has had no task activity for ' || row_data.days_inactive || ' day(s).',
        'suggested_action', 'Check in with ' || row_data.user_name || ' — may need task assignment or support.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
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
      from app_users u left join tasks t on t.assigned_to = u.id and t.created_at >= now() - interval '30 days'
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
        'insight_type', 'productivity_trend',
        'severity', case when row_data.completion_rate < 20 then 4 when row_data.completion_rate < 40 then 3 else 2 end,
        'title', 'Low completion rate: ' || row_data.user_name,
        'description', row_data.user_name || ' completed ' || round(row_data.completion_rate)::text || '% of assigned tasks in the last 30 days (' || row_data.done_tasks || '/' || row_data.total_tasks || ').',
        'suggested_action', 'Review blockers with ' || row_data.user_name || '. May need clearer priorities or scope adjustment.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
        'metadata', jsonb_build_object('completion_rate', row_data.completion_rate, 'done_tasks', row_data.done_tasks, 'total_tasks', row_data.total_tasks, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Burnout Risk: high task load
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select u.id as user_id, u.name as user_name, user_department(u) as dept,
        count(t.id) as active_tasks,
        coalesce((select sum(minutes) from time_logs where user_id = u.id and created_at >= now() - interval '7 days'), 0) as weekly_minutes,
        (select count(*) from proof_logs where user_id = u.id and created_at >= now() - interval '7 days') as weekly_proofs
      from app_users u left join tasks t on t.assigned_to = u.id and t.status <> 'DONE'
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and (p_target_user_id is null or u.id = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
      group by u.id, u.name, user_department(u)
      having count(t.id) >= 5 or (coalesce((select sum(minutes) from time_logs where user_id = u.id and created_at >= now() - interval '7 days'), 0) > 600)
      order by count(t.id) desc, weekly_minutes desc
      limit 10
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type', 'burnout_risk',
        'severity', case when row_data.active_tasks >= 10 or row_data.weekly_minutes > 1200 then 5 when row_data.active_tasks >= 7 or row_data.weekly_minutes > 800 then 4 else 3 end,
        'title', 'Burnout risk: ' || row_data.user_name,
        'description', row_data.user_name || ' has ' || row_data.active_tasks || ' active tasks and logged ' || (row_data.weekly_minutes / 60)::int || ' hours this week with ' || row_data.weekly_proofs || ' proof submissions.',
        'suggested_action', 'Consider redistributing some tasks from ' || row_data.user_name || '. Ensure sustainable workload.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
        'metadata', jsonb_build_object('active_tasks', row_data.active_tasks, 'weekly_minutes', row_data.weekly_minutes, 'weekly_proofs', row_data.weekly_proofs, 'template', p_template_key)
      ));
    end loop;
  end if;

  -- Proof Quality: tasks submitted without proof logs
  if p_template_key in ('weekly_company','monthly_company','department_summary','individual_review') then
    for row_data in
      select t.id as task_id, t.title, t.assigned_to as user_id, u.name as user_name, user_department(u) as dept,
        (select count(*) from proof_logs where task_id = t.id) as proof_count
      from tasks t join app_users u on u.id = t.assigned_to
      where t.status = 'SUBMITTED'
        and (p_target_user_id is null or t.assigned_to = p_target_user_id)
        and (p_target_department = '' or user_department(u) = p_target_department)
        and (select count(*) from proof_logs where task_id = t.id) = 0
      limit 15
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type', 'proof_quality',
        'severity', 2,
        'title', 'Submission without proof: ' || row_data.title,
        'description', row_data.user_name || ' submitted "' || row_data.title || '" but no proof logs were found.',
        'suggested_action', 'Request proof from ' || row_data.user_name || ' before final review.',
        'target_user_id', row_data.user_id,
        'target_department', coalesce(row_data.dept, ''),
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
        case when count(t.id) filter (where t.status <> 'DONE' and t.due_date < current_date) = 0 then 0 else count(t.id) filter (where t.status <> 'DONE' and t.due_date < current_date)::numeric / nullif(count(t.id) filter (where t.status <> 'DONE'), 0) * 100 end as overdue_rate
      from app_users u left join tasks t on t.assigned_to = u.id and t.created_at >= now() - interval '30 days'
      where u.active = true
        and u.role in ('FOUNDER','INTERN')
        and user_department(u) <> ''
        and (p_target_department = '' or user_department(u) = p_target_department)
      group by user_department(u)
      order by overdue desc, completion_rate asc
    loop
      insights_json := insights_json || jsonb_build_array(jsonb_build_object(
        'insight_type', 'department_performance',
        'severity', case when row_data.overdue_rate > 50 then 5 when row_data.overdue_rate > 30 then 4 when row_data.overdue_rate > 15 then 3 else 2 end,
        'title', 'Department health: ' || initcap(row_data.dept),
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

-- End of round 25.

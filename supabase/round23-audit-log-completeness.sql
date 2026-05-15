-- Phase 12 follow-up: audit log completeness (safe subset).
--
-- Adds audit_logs writes to two short, low-risk RPCs that previously left no
-- audit trail. The function bodies are copied verbatim from round19 and a
-- single `insert into audit_logs(...)` is appended. No semantic change to
-- behaviour; only the audit story improves.
--
-- Functions extended:
--   1. archive_task_template_rpc        — adds ARCHIVE_TEMPLATE / UNARCHIVE_TEMPLATE
--   2. set_recurring_task_active_rpc    — adds PAUSE_RECURRING / RESUME_RECURRING
--
-- Functions DELIBERATELY NOT TOUCHED tonight (documented in
-- SECURITY_RBAC_AUDIT.md as remaining gaps):
--   • upsert_task_template_rpc       — 376 lines, too large to redefine safely
--                                       without browser verification.
--   • generate_ai_report_rpc         — round20 file has a documented corruption
--                                       history; the audit insert should be
--                                       added in a focused daylight session.
--
-- Run order: must be applied AFTER round19 (templates+recurring) since this
-- replaces functions defined there. Idempotent — re-running is safe.

-- ─── archive_task_template_rpc ───────────────────────────────────────────────

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

  -- round23 audit completeness: every template archive/restore now leaves a trail.
  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values(me.id,
         case when saved.archived then 'ARCHIVE_TEMPLATE' else 'UNARCHIVE_TEMPLATE' end,
         'task_templates',
         saved.id,
         jsonb_build_object('archived', saved.archived));

  return jsonb_build_object('ok',true,'data',task_template_json(saved),'error',null);
end; $$;

-- ─── set_recurring_task_active_rpc ───────────────────────────────────────────

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

  -- round23 audit completeness: every pause/resume now leaves a trail.
  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values(me.id,
         case when saved.active then 'RESUME_RECURRING' else 'PAUSE_RECURRING' end,
         'recurring_tasks',
         saved.id,
         jsonb_build_object('active', saved.active));

  return jsonb_build_object('ok',true,'active',saved.active,'error',null);
end; $$;

-- End of round 23.

-- Bug fix: moderate_strike_rpc returning bigint into uuid variable.
--
-- Symptom (CEO clicks Add/Remove Strike on the Team page):
--   ERROR: invalid input syntax for type uuid: "<sequence-number>"
--
-- Root cause:
--   schema.sql:75  → `audit_logs.id` is `bigserial` (BIGINT).
--   round8-task-rbac-moderation.sql:6 declares `event_id uuid` and then
--   line 23 runs `returning id into event_id`. PostgreSQL coerces
--   bigint → text → uuid implicitly, and the text-to-uuid step rejects
--   any non-UUID-shaped string (e.g. "599") with the reported error.
--
-- Fix:
--   Redefine moderate_strike_rpc with `event_id bigint` instead of `uuid`.
--   Function body otherwise IDENTICAL to round8. No behaviour change, no
--   semantic change, no signature change. Idempotent — safe to re-run.
--
-- This affects both Add Strike (`p_delta = 1`) and Remove Strike
-- (`p_delta = -1`); both paths hit the same `returning id into event_id`
-- line. The fix restores both buttons.

create or replace function moderate_strike_rpc(p_token text, p_target_user_id uuid, p_delta int, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; target_user app_users; next_strikes int; event_id bigint;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;
  if me.role <> 'CEO' then return jsonb_build_object('ok',false,'data',null,'error','CEO only'); end if;
  if p_delta not in (-1, 1) then return jsonb_build_object('ok',false,'data',null,'error','Strike delta must be -1 or 1'); end if;
  if length(trim(coalesce(p_reason,''))) < 3 then return jsonb_build_object('ok',false,'data',null,'error','Moderation reason is required'); end if;

  select * into target_user from app_users where id=p_target_user_id and active=true;
  if target_user.id is null then return jsonb_build_object('ok',false,'data',null,'error','Target user not found'); end if;

  next_strikes := greatest(0, coalesce(target_user.strikes,0) + p_delta);
  update app_users set strikes=next_strikes where id=target_user.id;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,case when p_delta > 0 then 'MANUAL_STRIKE_ADD' else 'MANUAL_STRIKE_REMOVE' end,'app_users',target_user.id,
    jsonb_build_object('target_user_id',target_user.id,'target_name',target_user.name,'delta',p_delta,'reason',trim(p_reason),'strikes_before',target_user.strikes,'strikes_after',next_strikes))
  returning id into event_id;

  insert into activity_events(actor_id,event_type,target_kind,target_id,task_id,body,meta)
  values(me.id,case when p_delta > 0 then 'MANUAL_STRIKE_ADD' else 'MANUAL_STRIKE_REMOVE' end,'user',target_user.id,null,
    case when p_delta > 0 then 'Manual strike added' else 'Manual strike removed' end,
    jsonb_build_object('target_user_id',target_user.id,'target_name',target_user.name,'delta',p_delta,'reason',trim(p_reason),'audit_id',event_id));

  return jsonb_build_object('ok',true,'data',jsonb_build_object('user_id',target_user.id,'strikes',next_strikes),'error',null);
end; $$;

-- End of round 24.

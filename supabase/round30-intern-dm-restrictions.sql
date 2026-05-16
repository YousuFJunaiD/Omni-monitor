-- Phase 18.5: stricter DM rules + candidate-list RPC.
--
-- Background:
--   round29-internal-chat.sql shipped a permissive DM model — any active
--   user could DM any other active user. That was wrong for interns:
--   interns must be limited to DMing the head of their own department.
--
-- Final DM access matrix:
--
--   Caller         | Can DM…
--   ---------------+-----------------------------------------------------
--   CEO            | any active user (except self)
--   FOUNDER/BOARD  | any active user (except self)
--   INTERN         | only active FOUNDER or BOARD in the intern's own
--                  | user_department(); cannot DM CEO, other interns, or
--                  | unrelated departments. An intern with no department
--                  | (user_department() = '') has no allowed targets.
--
-- This migration:
--   1. Redefines create_dm_thread_rpc with the intern check. Function body
--      copied verbatim from round29 with the new gate inserted before the
--      existing membership lookup.
--   2. Adds get_chat_dm_candidates_rpc that returns the same allowlist
--      shape so the UI's New-DM picker matches what the server permits.
--      No more cases of the UI offering a contact who then fails the RPC.
--
-- Idempotent. Safe to re-run.

-- ─── Updated: create_dm_thread_rpc ──────────────────────────────────────────

create or replace function create_dm_thread_rpc(p_token text, p_other_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users;
  other app_users;
  my_dept text;
  other_dept text;
  existing_id uuid;
  new_thread chat_threads;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  if p_other_user_id is null or p_other_user_id = me.id then
    return jsonb_build_object('ok',false,'error','Pick a different user');
  end if;
  select * into other from app_users where id = p_other_user_id and active = true;
  if other.id is null then return jsonb_build_object('ok',false,'error','User not found'); end if;

  -- Phase 18.5: intern restriction. Interns may DM only the head/founder of
  -- their own department. Everything else is rejected with 'Not allowed'.
  if me.role = 'INTERN' then
    my_dept := user_department(me);
    other_dept := user_department(other);
    if my_dept = '' then
      return jsonb_build_object('ok',false,'error','Not allowed');
    end if;
    if other.role not in ('FOUNDER','BOARD') then
      return jsonb_build_object('ok',false,'error','Not allowed');
    end if;
    if other_dept = '' or other_dept <> my_dept then
      return jsonb_build_object('ok',false,'error','Not allowed');
    end if;
  end if;

  -- Existing logic from round29 — find or create the DM thread.
  select t.id into existing_id
  from chat_threads t
  where t.kind = 'dm'
    and exists (select 1 from chat_thread_members m1 where m1.thread_id = t.id and m1.user_id = me.id)
    and exists (select 1 from chat_thread_members m2 where m2.thread_id = t.id and m2.user_id = other.id)
    and (select count(*) from chat_thread_members m where m.thread_id = t.id) = 2
  limit 1;
  if existing_id is not null then
    return jsonb_build_object('ok', true, 'thread_id', existing_id, 'created', false);
  end if;

  insert into chat_threads(kind, title, created_by) values ('dm', null, me.id) returning * into new_thread;
  insert into chat_thread_members(thread_id, user_id) values (new_thread.id, me.id), (new_thread.id, other.id);
  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values (me.id, 'CHAT_THREAD_CREATED', 'chat_threads', new_thread.id,
          jsonb_build_object('kind', 'dm', 'other_user_id', other.id, 'other_user_name', other.name));

  return jsonb_build_object('ok', true, 'thread_id', new_thread.id, 'created', true);
end; $$;

-- ─── New: get_chat_dm_candidates_rpc ────────────────────────────────────────
--
-- Returns the list of users the caller is currently allowed to DM. Mirrors
-- the rules inside create_dm_thread_rpc so the picker UI cannot offer an
-- option the server would then refuse.
--
-- Output shape:
--   { ok: true, candidates: [ { id, name, role, title, avatar_data_url } ] }

create or replace function get_chat_dm_candidates_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; my_dept text; rows jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  if me.role = 'INTERN' then
    my_dept := user_department(me);
    if my_dept = '' then
      return jsonb_build_object('ok', true, 'candidates', '[]'::jsonb);
    end if;
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'role', u.role,
      'title', u.title,
      'avatar_data_url', u.avatar_data_url
    ) order by u.name)
    into rows
    from app_users u
    where u.active = true
      and u.role in ('FOUNDER','BOARD')
      and user_department(u) = my_dept
      and u.id <> me.id;
  else
    -- CEO / FOUNDER / BOARD — every active user except self.
    select jsonb_agg(jsonb_build_object(
      'id', u.id,
      'name', u.name,
      'role', u.role,
      'title', u.title,
      'avatar_data_url', u.avatar_data_url
    ) order by u.name)
    into rows
    from app_users u
    where u.active = true and u.id <> me.id;
  end if;

  return jsonb_build_object('ok', true, 'candidates', coalesce(rows, '[]'::jsonb));
end; $$;

grant execute on function get_chat_dm_candidates_rpc(text) to authenticated;
grant execute on function create_dm_thread_rpc(text, uuid) to authenticated;

-- End of round 30.

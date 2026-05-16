-- Phase 18: Internal chat.
--
-- Adds a simple chat layer on top of the existing user/role model. Four
-- thread kinds:
--
--   'dm'         — one-to-one direct message. Membership is explicit via
--                  chat_thread_members (exactly two rows).
--   'department' — channel scoped to a department. Membership is DERIVED:
--                  CEO sees all department threads; otherwise the caller's
--                  user_department() must match thread.department.
--                  Explicit chat_thread_members rows can also grant access
--                  (used for the Marketing/Sales channel where there is no
--                  user_department() bucket today).
--   'leadership' — channel for CEO/FOUNDER/BOARD only. Membership DERIVED
--                  from role. INTERNS are excluded by design.
--   'task'       — channel attached to a task. Visibility DERIVED from
--                  can_view_department_task — same RBAC as the task itself.
--
-- No real-time subscriptions in V1. Clients refresh manually. No file
-- upload. No edits/deletes (writes are append-only — message immutability
-- keeps history auditable).
--
-- Audit:
--   CHAT_THREAD_CREATED — on thread creation (including DM auto-create and
--                          task-thread auto-create).
--   CHAT_MESSAGE_SENT   — on every message send. meta carries thread_id and
--                          thread_kind (no body content — privacy).
--
-- Idempotent. Safe to re-run.

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm','department','leadership','task')),
  title text,
  department text,
  task_id uuid references tasks(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_threads_kind_dept on chat_threads(kind, department);
create index if not exists idx_chat_threads_task on chat_threads(task_id) where task_id is not null;

create table if not exists chat_thread_members (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_chat_members_user on chat_thread_members(user_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null references app_users(id) on delete set null,
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_thread_created on chat_messages(thread_id, created_at desc);

create table if not exists chat_reads (
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table chat_threads enable row level security;
alter table chat_thread_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_reads enable row level security;
-- No RLS policies. All access goes through SECURITY DEFINER RPCs which
-- check can_view_chat_thread() internally.

-- ─── RBAC helper ─────────────────────────────────────────────────────────────

create or replace function can_view_chat_thread(p_user app_users, p_thread chat_threads)
returns boolean language plpgsql stable as $$
declare task_row tasks;
begin
  if p_user.id is null or p_thread.id is null then return false; end if;
  -- CEO sees everything except INTERN-only DMs they are not part of.
  -- For DMs we require explicit membership EVEN for CEO so private 1-1
  -- conversations stay private.
  if p_thread.kind = 'leadership' then
    return p_user.role in ('CEO','FOUNDER','BOARD');
  end if;
  if p_thread.kind = 'department' then
    if p_user.role = 'CEO' then return true; end if;
    if coalesce(p_thread.department,'') <> ''
       and user_department(p_user) <> ''
       and user_department(p_user) = p_thread.department then
      return true;
    end if;
    -- Explicit member override (for departments outside user_department()
    -- buckets, e.g. the Marketing/Sales channel).
    return exists (
      select 1 from chat_thread_members m
      where m.thread_id = p_thread.id and m.user_id = p_user.id
    );
  end if;
  if p_thread.kind = 'task' then
    if p_thread.task_id is null then return false; end if;
    select * into task_row from tasks where id = p_thread.task_id;
    if task_row.id is null then return false; end if;
    return can_view_department_task(p_user, task_row);
  end if;
  if p_thread.kind = 'dm' then
    return exists (
      select 1 from chat_thread_members m
      where m.thread_id = p_thread.id and m.user_id = p_user.id
    );
  end if;
  return false;
end; $$;

-- ─── Helper: list members of a thread (for "with N people" UI) ──────────────

create or replace function chat_thread_member_count(p_thread chat_threads)
returns int language plpgsql stable as $$
declare n int := 0;
begin
  if p_thread.kind = 'leadership' then
    select count(*)::int into n from app_users where active = true and role in ('CEO','FOUNDER','BOARD');
    return n;
  end if;
  if p_thread.kind = 'department' then
    if coalesce(p_thread.department,'') <> '' then
      select count(*)::int into n from app_users u
      where u.active = true and user_department(u) = p_thread.department;
    end if;
    -- Plus explicit invitees not already counted by department.
    return n + (select count(*)::int from chat_thread_members m
                join app_users u on u.id = m.user_id
                where m.thread_id = p_thread.id and u.active = true
                  and (coalesce(p_thread.department,'') = '' or user_department(u) <> p_thread.department));
  end if;
  if p_thread.kind in ('dm','task') then
    return (select count(*)::int from chat_thread_members m where m.thread_id = p_thread.id);
  end if;
  return 0;
end; $$;

-- ─── RPC: list threads the caller can see ───────────────────────────────────

create or replace function get_chat_threads_rpc(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; items jsonb;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select jsonb_agg(row_to_json(x) order by x.last_message_at desc nulls last, x.created_at desc) into items
  from (
    select t.id, t.kind, t.title, t.department, t.task_id, t.created_by, t.created_at,
      -- For DMs, surface the "other person" name to render a useful title client-side.
      (case
         when t.kind = 'dm' then (
           select string_agg(u.name, ', ' order by u.name)
           from chat_thread_members m join app_users u on u.id = m.user_id
           where m.thread_id = t.id and u.id <> me.id
         )
         when t.kind = 'task' then (select title from tasks where id = t.task_id)
         else null
       end) as derived_title,
      (select max(created_at) from chat_messages m where m.thread_id = t.id) as last_message_at,
      (select count(*)::int from chat_messages m
         where m.thread_id = t.id
           and m.created_at > coalesce((select last_read_at from chat_reads r
                                        where r.thread_id = t.id and r.user_id = me.id),
                                       'epoch'::timestamptz)) as unread_count,
      chat_thread_member_count(t.*) as member_count
    from chat_threads t
    where can_view_chat_thread(me, t.*)
    order by last_message_at desc nulls last, t.created_at desc
  ) x;

  return jsonb_build_object('ok',true,'threads',coalesce(items,'[]'::jsonb));
end; $$;

-- ─── RPC: fetch messages for a thread ───────────────────────────────────────

create or replace function get_chat_messages_rpc(p_token text, p_thread_id uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; thread chat_threads; items jsonb; safe_limit int;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into thread from chat_threads where id = p_thread_id;
  if thread.id is null then return jsonb_build_object('ok',false,'error','Thread not found'); end if;
  if not can_view_chat_thread(me, thread) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  safe_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  -- Pull newest N, then return in chronological order so the client renders
  -- top-to-bottom without re-sorting.
  with msgs as (
    select m.id, m.thread_id, m.sender_id, m.body, m.created_at,
      u.name sender_name, u.role sender_role, u.avatar_data_url sender_avatar
    from chat_messages m left join app_users u on u.id = m.sender_id
    where m.thread_id = thread.id
    order by m.created_at desc
    limit safe_limit
  )
  select jsonb_agg(row_to_json(m) order by m.created_at asc) into items from msgs m;

  return jsonb_build_object(
    'ok', true,
    'thread', jsonb_build_object(
      'id', thread.id, 'kind', thread.kind, 'title', thread.title,
      'department', thread.department, 'task_id', thread.task_id
    ),
    'messages', coalesce(items, '[]'::jsonb)
  );
end; $$;

-- ─── RPC: send a message ────────────────────────────────────────────────────

create or replace function send_chat_message_rpc(p_token text, p_thread_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; thread chat_threads; msg chat_messages; cleaned text;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;

  select * into thread from chat_threads where id = p_thread_id;
  if thread.id is null then return jsonb_build_object('ok',false,'error','Thread not found'); end if;
  if not can_view_chat_thread(me, thread) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  cleaned := trim(coalesce(p_body, ''));
  if length(cleaned) = 0 then return jsonb_build_object('ok',false,'error','Empty message'); end if;
  if length(cleaned) > 4000 then return jsonb_build_object('ok',false,'error','Message too long (max 4000 chars)'); end if;

  insert into chat_messages(thread_id, sender_id, body)
  values (thread.id, me.id, cleaned)
  returning * into msg;

  -- Auto-mark-read for the sender so their own message doesn't count as unread.
  insert into chat_reads(thread_id, user_id, last_read_at)
  values (thread.id, me.id, msg.created_at)
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values (me.id, 'CHAT_MESSAGE_SENT', 'chat_messages', msg.id,
          jsonb_build_object('thread_id', thread.id, 'thread_kind', thread.kind, 'thread_title', thread.title));

  return jsonb_build_object(
    'ok', true,
    'message', jsonb_build_object(
      'id', msg.id, 'thread_id', msg.thread_id, 'sender_id', msg.sender_id,
      'sender_name', me.name, 'sender_role', me.role,
      'body', msg.body, 'created_at', msg.created_at
    )
  );
end; $$;

-- ─── RPC: mark a thread as read ─────────────────────────────────────────────

create or replace function mark_chat_read_rpc(p_token text, p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; thread chat_threads;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into thread from chat_threads where id = p_thread_id;
  if thread.id is null then return jsonb_build_object('ok',false,'error','Thread not found'); end if;
  if not can_view_chat_thread(me, thread) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  insert into chat_reads(thread_id, user_id, last_read_at)
  values (thread.id, me.id, now())
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  return jsonb_build_object('ok', true);
end; $$;

-- ─── RPC: get-or-create one-to-one DM thread ────────────────────────────────

create or replace function create_dm_thread_rpc(p_token text, p_other_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users; other app_users;
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
  -- Interns may only DM users they share a thread/dept with: keep it simple,
  -- allow any active-to-active DM. Restrict later if needed.

  -- Look for an existing DM thread that has exactly these two members.
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

-- ─── RPC: get-or-create a task-linked thread ────────────────────────────────

create or replace function get_or_create_task_thread_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me app_users; task_row tasks;
  existing_id uuid;
  new_thread chat_threads;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into task_row from tasks where id = p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'error','Task not found'); end if;
  if not can_view_department_task(me, task_row) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;

  select id into existing_id from chat_threads where kind = 'task' and task_id = task_row.id limit 1;
  if existing_id is not null then
    return jsonb_build_object('ok', true, 'thread_id', existing_id, 'created', false);
  end if;

  insert into chat_threads(kind, title, task_id, created_by)
  values ('task', task_row.title, task_row.id, me.id)
  returning * into new_thread;

  insert into audit_logs(actor_id, action, target_table, target_id, meta)
  values (me.id, 'CHAT_THREAD_CREATED', 'chat_threads', new_thread.id,
          jsonb_build_object('kind', 'task', 'task_id', task_row.id, 'task_title', task_row.title));

  return jsonb_build_object('ok', true, 'thread_id', new_thread.id, 'created', true);
end; $$;

-- ─── Seed built-in department + leadership threads (idempotent) ─────────────

insert into chat_threads (kind, title, department)
select 'department', 'Frontend Team', 'frontend'
where not exists (select 1 from chat_threads where kind = 'department' and department = 'frontend');

insert into chat_threads (kind, title, department)
select 'department', 'Backend Team', 'backend'
where not exists (select 1 from chat_threads where kind = 'department' and department = 'backend');

-- Marketing/Sales uses a non-empty department slug 'marketing_sales'. Membership
-- is explicit (via chat_thread_members) since user_department() returns ''
-- for sales users today.
insert into chat_threads (kind, title, department)
select 'department', 'Marketing & Sales', 'marketing_sales'
where not exists (select 1 from chat_threads where kind = 'department' and department = 'marketing_sales');

-- Seed sales-channel members: active interns whose title contains 'sales'
-- or 'marketing' (case-insensitive). CEO sees the channel by RBAC anyway.
insert into chat_thread_members (thread_id, user_id)
select t.id, u.id
from chat_threads t
join app_users u on u.active = true
  and (u.title ilike '%sales%' or u.title ilike '%marketing%')
where t.kind = 'department' and t.department = 'marketing_sales'
on conflict do nothing;

insert into chat_threads (kind, title)
select 'leadership', 'Leadership'
where not exists (select 1 from chat_threads where kind = 'leadership');

-- ─── Grants ─────────────────────────────────────────────────────────────────

grant execute on function can_view_chat_thread(app_users, chat_threads) to authenticated;
grant execute on function chat_thread_member_count(chat_threads) to authenticated;
grant execute on function get_chat_threads_rpc(text) to authenticated;
grant execute on function get_chat_messages_rpc(text, uuid, int) to authenticated;
grant execute on function send_chat_message_rpc(text, uuid, text) to authenticated;
grant execute on function mark_chat_read_rpc(text, uuid) to authenticated;
grant execute on function create_dm_thread_rpc(text, uuid) to authenticated;
grant execute on function get_or_create_task_thread_rpc(text, uuid) to authenticated;

-- End of round 29.

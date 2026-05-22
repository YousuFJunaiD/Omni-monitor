-- Phase 19: add backend interns and keep department/chat RBAC aligned.
-- Safe/idempotent: no table reset, no existing user deletion, no plaintext in audit logs.

create extension if not exists pgcrypto;

create or replace function user_department(p_user app_users)
returns text language sql stable as $$
  select case
    when p_user.username in ('aarzoo.anna','ruqiya.n','mazen.ahmed','polok.k','syed.firas','lotifur.r')
      or lower(coalesce(p_user.title,'')) like '%frontend%'
      or lower(coalesce(p_user.title,'')) like '%cpo%'
      or lower(coalesce(p_user.title,'')) like '%cxo%'
      then 'frontend'
    when p_user.username in ('akshaya.r','ismail.q','mazharuddin.s','nihan.anoop','tran.tai','ehan.shareef')
      or lower(coalesce(p_user.title,'')) like '%backend%'
      or lower(coalesce(p_user.title,'')) like '%cto%'
      or lower(coalesce(p_user.title,'')) like '%csa%'
      then 'backend'
    else ''
  end
$$;

do $$
declare
  intern record;
  user_id uuid;
  existed boolean;
begin
  for intern in
    select *
    from (
      values
        ('M Nihan Anoop', 'nihan.anoop', 'Omni@Nihan2026!'),
        ('Tran Huu Tai', 'tran.tai', 'Omni@Tran2026!'),
        ('Mohammed Mukashiff Ehan Shareef', 'ehan.shareef', 'Omni@Ehan2026!')
    ) as v(name, username, temp_password)
  loop
    select exists(select 1 from app_users where username = intern.username) into existed;

    if existed then
      update app_users
      set name = intern.name,
        password_hash = crypt(intern.temp_password, gen_salt('bf')),
        role = 'INTERN',
        title = 'Backend Developer Intern',
        active = true
      where username = intern.username
      returning id into user_id;

      insert into audit_logs(actor_id, action, target_table, target_id, meta)
      values(null, 'INTERN_PASSWORD_RESET', 'app_users', user_id,
        jsonb_build_object('username', intern.username, 'role', 'INTERN', 'title', 'Backend Developer Intern', 'department', 'backend'));
    else
      insert into app_users(name, username, password_hash, role, title, active)
      values(intern.name, intern.username, crypt(intern.temp_password, gen_salt('bf')), 'INTERN', 'Backend Developer Intern', true)
      returning id into user_id;

      insert into audit_logs(actor_id, action, target_table, target_id, meta)
      values(null, 'USER_CREATED', 'app_users', user_id,
        jsonb_build_object('username', intern.username, 'role', 'INTERN', 'title', 'Backend Developer Intern', 'department', 'backend'));

      insert into audit_logs(actor_id, action, target_table, target_id, meta)
      values(null, 'INITIAL_PASSWORD_SET', 'app_users', user_id,
        jsonb_build_object('username', intern.username, 'method', 'bcrypt_pgcrypto'));
    end if;
  end loop;
end $$;

-- Backend Team chat visibility is department-derived, but keep the channel
-- present for fresh databases that apply later rounds selectively.
insert into chat_threads (kind, title, department)
select 'department', 'Backend Team', 'backend'
where to_regclass('public.chat_threads') is not null
  and not exists (select 1 from chat_threads where kind = 'department' and department = 'backend');

grant execute on function user_department(app_users) to anon, authenticated;

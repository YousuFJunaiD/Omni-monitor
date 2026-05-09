-- supabase/round6-add-developer-interns.sql
-- Non-destructive, idempotent migration.
-- Adds developer interns with bcrypt-compatible pgcrypto hashes.
-- Does not reset tables and does not modify existing users.

create extension if not exists pgcrypto;

-- Requested usernames contain dots. Older installs may still have a
-- username CHECK constraint that only allows underscores, so widen only
-- username regex checks before inserting these new accounts.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.app_users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%username%'
  loop
    execute format('alter table public.app_users drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table public.app_users
  add constraint app_users_username_format_check
  check (username ~ '^[a-z0-9_.]{3,40}$');

insert into public.app_users(name, username, password_hash, role, title)
values
  ('Aarzoo Anna', 'aarzoo.anna', crypt('48271635', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Bibi Ruqiya Nashipudi', 'ruqiya.n', crypt('73194528', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Mazen Ahmed', 'mazen.ahmed', crypt('86421957', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Polok Kumar', 'polok.k', crypt('29578146', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Syed Firas', 'syed.firas', crypt('61732489', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Lotifur Rahman', 'lotifur.r', crypt('54819372', gen_salt('bf')), 'INTERN', 'Frontend Developer Intern'),
  ('Akshaya Ramesh', 'akshaya.r', crypt('93647215', gen_salt('bf')), 'INTERN', 'Backend Developer Intern'),
  ('Ismail Qamri', 'ismail.q', crypt('47182536', gen_salt('bf')), 'INTERN', 'Backend Developer Intern'),
  ('Shaikh MD Mazharuddin', 'mazharuddin.s', crypt('78246195', gen_salt('bf')), 'INTERN', 'Backend Developer Intern')
on conflict (username) do nothing;

-- Optional verification query after running:
-- select name, username, role, title, active, password_hash like '$2%' as password_hash_generated
-- from public.app_users
-- where username in (
--   'aarzoo.anna','ruqiya.n','mazen.ahmed','polok.k','syed.firas','lotifur.r',
--   'akshaya.r','ismail.q','mazharuddin.s'
-- )
-- order by title, name;

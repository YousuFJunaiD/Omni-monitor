-- Non-destructive migration: adds the task deletion RPC without resetting data.
-- Run in Supabase SQL Editor before deploying the frontend delete button.

create or replace function delete_task_rpc(p_token text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; assignee app_users;
begin
  select * into me from private_user_from_token(p_token); if me.id is null then return jsonb_build_object('ok',false,'error','Unauthorized'); end if;
  select * into task_row from tasks where id=p_task_id; if task_row.id is null then return jsonb_build_object('ok',false,'error','Task not found'); end if;
  select * into assignee from app_users where id=task_row.assigned_to;
  if not (me.role='CEO' or (me.role='BOARD' and assignee.role='INTERN')) then return jsonb_build_object('ok',false,'error','Not allowed'); end if;
  delete from tasks where id=p_task_id;
  insert into audit_logs(actor_id,action,target_table,target_id,meta) values(me.id,'DELETE_TASK','tasks',p_task_id,jsonb_build_object('assigned_to',task_row.assigned_to));
  return jsonb_build_object('ok',true);
end; $$;

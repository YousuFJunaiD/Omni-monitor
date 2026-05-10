-- Restrict task status updates to CEO or assigned user only.
-- Apply this migration in Supabase after deploying the frontend fix.

create or replace function update_task_status_rpc(p_token text, p_task_id uuid, p_status task_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me app_users; task_row tasks; updated_task tasks; old_status task_status;
begin
  select * into me from private_user_from_token(p_token);
  if me.id is null then return jsonb_build_object('ok',false,'data',null,'error','Unauthorized'); end if;

  select * into task_row from tasks where id=p_task_id;
  if task_row.id is null then return jsonb_build_object('ok',false,'data',null,'error','Task not found'); end if;

  if not (me.role='CEO' or task_row.assigned_to=me.id) then
    return jsonb_build_object('ok',false,'data',null,'error','Not allowed');
  end if;

  old_status := task_row.status;

  update tasks
  set status=p_status,
      completed_at=case when p_status='DONE' then coalesce(completed_at,now()) else completed_at end
  where id=p_task_id
  returning * into updated_task;

  insert into audit_logs(actor_id,action,target_table,target_id,meta)
  values(me.id,'UPDATE_STATUS','tasks',p_task_id,jsonb_build_object('from',old_status,'to',p_status));

  return jsonb_build_object('ok',true,'data',round4_task_json(updated_task),'error',null);
end; $$;

grant execute on function update_task_status_rpc(text, uuid, task_status) to anon, authenticated;

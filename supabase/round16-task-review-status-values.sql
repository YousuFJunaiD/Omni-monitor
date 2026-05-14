-- Add review workflow task statuses first.
-- Run this before round17-enterprise-review-workflow.sql.

do $$
begin
  alter type task_status add value if not exists 'UNDER_REVIEW';
  alter type task_status add value if not exists 'APPROVED';
  alter type task_status add value if not exists 'CHANGES_REQUESTED';
  alter type task_status add value if not exists 'RESUBMITTED';
  alter type task_status add value if not exists 'REJECTED';
end $$;

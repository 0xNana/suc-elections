drop index if exists public.idx_student_id_lookup;

create index if not exists students_full_name_idx
  on public.students (full_name asc, student_id asc);

create index if not exists students_role_full_name_idx
  on public.students (role, full_name asc, student_id asc);

create index if not exists students_eligible_full_name_idx
  on public.students (full_name asc, student_id asc)
  where is_eligible = true;

create index if not exists students_activated_full_name_idx
  on public.students (full_name asc, student_id asc)
  where activated_at is not null;

create index if not exists students_pending_full_name_idx
  on public.students (full_name asc, student_id asc)
  where activated_at is null;

create index if not exists audit_log_event_logged_at_idx
  on public.audit_log (event_type, logged_at desc);

create index if not exists audit_log_login_actor_logged_at_idx
  on public.audit_log (actor_token, logged_at desc)
  where event_type = 'LOGIN';

create index if not exists election_config_poll_closes_desc_idx
  on public.election_config (poll_closes desc);

create index if not exists election_config_results_counted_by_idx
  on public.election_config (results_counted_by)
  where results_counted_by is not null;

create index if not exists election_config_results_released_by_idx
  on public.election_config (results_released_by)
  where results_released_by is not null;

create index if not exists result_verifications_verifier_auth_user_id_idx
  on public.result_verifications (verifier_auth_user_id);

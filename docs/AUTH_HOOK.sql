create extension if not exists pgcrypto;

grant usage on schema public to supabase_auth_admin;
grant select on table public.students to supabase_auth_admin;

drop policy if exists auth_admin_read_students_for_hook on public.students;
create policy auth_admin_read_students_for_hook
  on public.students
  for select
  to supabase_auth_admin
  using (true);

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  claims jsonb;
  student_row public.students;
begin
  claims := event->'claims';

  select *
  into student_row
  from public.students
  where auth_user_id = (event->>'user_id')::uuid
  limit 1;

  if student_row.id is not null then
    claims := jsonb_set(claims, '{role}', to_jsonb(student_row.role));
    claims := jsonb_set(claims, '{can_vote}', to_jsonb(student_row.can_vote));
    claims := jsonb_set(claims, '{student_id}', to_jsonb(student_row.student_id));
    claims := jsonb_set(
      claims,
      '{voter_token}',
      to_jsonb(encode(digest(student_row.voter_token, 'sha256'), 'hex'))
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;

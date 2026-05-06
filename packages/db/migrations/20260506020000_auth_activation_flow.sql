alter table public.students
  add column if not exists activation_code text,
  add column if not exists activated_at timestamptz,
  add column if not exists role varchar(20) not null default 'voter',
  add column if not exists can_vote boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'valid_role'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint valid_role
      check (role in ('voter', 'aspirant_rep', 'ec_admin'));
  end if;
end $$;

create unique index if not exists idx_students_activation_code_unique
  on public.students (activation_code)
  where activation_code is not null;

create index if not exists idx_activation_code
  on public.students (activation_code)
  where activated_at is null
    and activation_code is not null;

create index if not exists idx_student_id_lookup
  on public.students (student_id);

grant select, insert, update, delete on public.students to authenticated;

drop policy if exists ec_admin_manage_students on public.students;
create policy ec_admin_manage_students
  on public.students
  for all
  to authenticated
  using (
    coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role'
    ) = 'ec_admin'
  )
  with check (
    coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role'
    ) = 'ec_admin'
  );

comment on column public.students.can_vote is
  'Controls whether this person may access the ballot and cast votes, independently of dashboard/admin role.';

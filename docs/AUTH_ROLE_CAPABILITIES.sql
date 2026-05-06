alter table public.students
  add column if not exists can_vote boolean not null default true;

comment on column public.students.can_vote is
  'Controls whether this person may access the ballot and cast votes, independently of dashboard/admin role.';

update public.students
set can_vote = case
  when role = 'voter' then true
  else false
end
where can_vote is null;

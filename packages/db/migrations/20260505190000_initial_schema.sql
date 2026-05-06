create extension if not exists pgcrypto;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_id varchar(20) unique not null,
  auth_user_id uuid references auth.users(id) unique,
  voter_token text unique not null,
  full_name varchar(200) not null,
  is_eligible boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  title varchar(100) not null,
  display_order integer not null,
  is_active boolean not null default true
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete cascade,
  full_name varchar(200) not null,
  photo_url text,
  ballot_num integer not null,
  manifesto_url text,
  unique (position_id, ballot_num),
  unique (id, position_id)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions(id) on delete restrict,
  candidate_id uuid not null,
  voter_token text not null,
  cast_at timestamptz not null default now(),
  unique (voter_token, position_id),
  constraint votes_candidate_matches_position_fk
    foreign key (candidate_id, position_id)
    references public.candidates (id, position_id)
    on delete restrict
);

drop rule if exists no_update_votes on public.votes;
drop rule if exists no_delete_votes on public.votes;
create rule no_update_votes as on update to public.votes do instead nothing;
create rule no_delete_votes as on delete to public.votes do instead nothing;

create table if not exists public.audit_log (
  id bigserial primary key,
  event_type varchar(50) not null,
  actor_token text,
  ip_address inet,
  payload_hash text,
  metadata jsonb,
  logged_at timestamptz not null default now()
);

drop rule if exists no_update_audit on public.audit_log;
drop rule if exists no_delete_audit on public.audit_log;
create rule no_update_audit as on update to public.audit_log do instead nothing;
create rule no_delete_audit as on delete to public.audit_log do instead nothing;

create table if not exists public.election_config (
  id uuid primary key default gen_random_uuid(),
  poll_opens timestamptz not null,
  poll_closes timestamptz not null,
  is_locked boolean not null default false,
  check (poll_opens < poll_closes)
);

create index if not exists positions_display_order_idx on public.positions (display_order);
create index if not exists candidates_position_id_idx on public.candidates (position_id);
create index if not exists votes_position_candidate_idx on public.votes (position_id, candidate_id);
create index if not exists audit_log_logged_at_idx on public.audit_log (logged_at desc);
create index if not exists audit_log_event_type_idx on public.audit_log (event_type);

drop view if exists public.results;
create view public.results as
  select
    p.id as position_id,
    p.title as position,
    p.display_order,
    c.id as candidate_id,
    c.full_name as candidate,
    c.ballot_num,
    c.photo_url,
    count(v.id)::integer as vote_count
  from public.positions p
  join public.candidates c
    on c.position_id = p.id
  left join public.votes v
    on v.candidate_id = c.id
   and v.position_id = p.id
  group by p.id, p.title, p.display_order, c.id, c.full_name, c.ballot_num, c.photo_url
  order by p.display_order, vote_count desc, c.ballot_num asc;

alter table public.students enable row level security;
alter table public.positions enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;
alter table public.audit_log enable row level security;
alter table public.election_config enable row level security;

drop policy if exists students_self_read on public.students;
create policy students_self_read
  on public.students
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists positions_public_read on public.positions;
create policy positions_public_read
  on public.positions
  for select
  to anon, authenticated
  using (true);

drop policy if exists candidates_public_read on public.candidates;
create policy candidates_public_read
  on public.candidates
  for select
  to anon, authenticated
  using (true);

drop policy if exists votes_no_select on public.votes;
create policy votes_no_select
  on public.votes
  for select
  using (false);

drop policy if exists votes_insert_via_service on public.votes;
create policy votes_insert_via_service
  on public.votes
  for insert
  to service_role
  with check (true);

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert
  on public.audit_log
  for insert
  to service_role
  with check (true);

drop policy if exists audit_read_for_reps on public.audit_log;
create policy audit_read_for_reps
  on public.audit_log
  for select
  to authenticated
  using (
    coalesce(
      auth.jwt() ->> 'role',
      auth.jwt() -> 'app_metadata' ->> 'role'
    ) = 'aspirant_rep'
  );

drop policy if exists election_config_public_read on public.election_config;
create policy election_config_public_read
  on public.election_config
  for select
  to anon, authenticated
  using (true);

grant select on public.students, public.positions, public.candidates, public.election_config to authenticated;
grant select on public.positions, public.candidates, public.election_config to anon;
grant select on public.votes, public.audit_log to authenticated;
grant insert on public.votes, public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;

revoke update, delete on public.votes from public, anon, authenticated;
revoke update, delete on public.audit_log from public, anon, authenticated;

comment on view public.results is
  'Canonical aggregated count surface for SUC-VOTE. Query through the backend so the public seal remains enforceable until polls close.';

comment on table public.votes is
  'Append-only vote ledger. Supabase Realtime must never subscribe directly to this table.';

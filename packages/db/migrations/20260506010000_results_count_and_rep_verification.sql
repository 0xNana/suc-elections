alter table public.election_config
  add column if not exists results_counted_at timestamptz,
  add column if not exists results_counted_by uuid references auth.users(id);

create table if not exists public.result_verifications (
  id uuid primary key default gen_random_uuid(),
  election_config_id uuid not null references public.election_config(id) on delete cascade,
  verifier_auth_user_id uuid not null references auth.users(id),
  message text not null,
  verified_at timestamptz not null default now(),
  unique (election_config_id, verifier_auth_user_id)
);

create index if not exists result_verifications_config_idx
  on public.result_verifications (election_config_id, verified_at desc);

comment on column public.election_config.results_counted_at is
  'Set by an EC account when the official count is generated for review.';

comment on column public.election_config.results_counted_by is
  'Auth user id of the EC account that generated the official count.';

comment on table public.result_verifications is
  'Verification messages from aspirant reps after the EC has generated the official count.';

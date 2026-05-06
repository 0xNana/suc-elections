alter table public.election_config
  add column if not exists results_released_at timestamptz,
  add column if not exists results_released_by uuid references auth.users(id);

comment on column public.election_config.results_released_at is
  'Set by an EC account when results are intentionally released to the public.';

comment on column public.election_config.results_released_by is
  'Auth user id of the EC account that released results to the public.';

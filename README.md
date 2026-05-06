# SouthShore University College SRC Electronic Voting System

Secure monorepo for the SouthShore University College SRC election platform.

## Stack

- Frontend: Next.js 14, App Router, TypeScript, Tailwind CSS
- Backend: Node.js + Express
- Database: Supabase Postgres
- Auth: Supabase Auth with activation-code onboarding
- Realtime: Supabase Realtime for controlled result updates
- Package manager: `pnpm`

## Monorepo Layout

```text
apps/
  api/   Express backend
  web/   Next.js frontend

packages/
  db/     SQL migrations, seed scripts, database types
  shared/ shared zod schemas and TypeScript contracts
```

## Core Roles

- `voter`
- `aspirant_rep`
- `ec_admin`

Voting permission is separate from role.

- `role` controls which dashboard or control area a person can access.
- `can_vote` controls whether the person may access the ballot and cast votes.

## Authentication Model

This project uses activation-code onboarding.

1. The Electoral Commission issues a one-time activation code.
2. The user activates the account and sets a password.
3. The user signs in with `student_id` and password.

See:

- [docs/AUTH.md](docs/AUTH.md)
- [docs/AUTH_HOOK.sql](docs/AUTH_HOOK.sql)
- [docs/AUTH_ROLE_CAPABILITIES.sql](docs/AUTH_ROLE_CAPABILITIES.sql)

## Election Flow

1. EC sets poll open and close times.
2. EC opens the poll or waits for the schedule.
3. Students vote.
4. EC closes the poll.
5. EC counts results.
6. Aspirant reps review and submit verification messages.
7. EC releases results to the public.

See:

- [docs/AUDIT.md](docs/AUDIT.md)
- [docs/EC_RESULTS_WORKFLOW.sql](docs/EC_RESULTS_WORKFLOW.sql)

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_API_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` or `SUPABASE_SECRET_KEY`
- `DATABASE_URL`
- `CORS_ORIGIN`

3. Apply database migrations:

```bash
pnpm db:migrate
```

4. Seed demo data:

```bash
pnpm db:seed
```

5. Start the apps:

```bash
pnpm dev
```

## Supabase Project Setup

Run these SQL files manually in Supabase SQL Editor if the live database is missing newer schema additions:

- [docs/AUTH_ROLE_CAPABILITIES.sql](docs/AUTH_ROLE_CAPABILITIES.sql)
- [docs/EC_RESULTS_WORKFLOW.sql](docs/EC_RESULTS_WORKFLOW.sql)
- [docs/AUTH_HOOK.sql](docs/AUTH_HOOK.sql)

## Student Import Shape

Recommended import CSV shape:

- `full_name`
- `student_id`
- `programme`
- `level`
- `role`
- `can_vote`

Files:

- [docs/STUDENT_IMPORT_SAMPLE.csv](docs/STUDENT_IMPORT_SAMPLE.csv)
- [docs/PROGRAMMES_FROM_TIMETABLE.md](docs/PROGRAMMES_FROM_TIMETABLE.md)

## Deployment

### Backend on Render

- deploy `apps/api`
- set backend environment variables
- make sure `CORS_ORIGIN` points to the frontend domain

### Frontend on Vercel

- deploy `apps/web`
- set:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_API_URL`

## Commands

```bash
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm test
```

## Demo Access

- EC admin login ID: `ECADMIN01`
- EC admin password: `EcSecure123!`

Activation codes are managed through the admin flow and may change after resets.

## Security

See:

- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/AUTH.md](docs/AUTH.md)
- [docs/AUDIT.md](docs/AUDIT.md)

## License

This repository uses the MIT license with SouthShore University College as the copyright holder.

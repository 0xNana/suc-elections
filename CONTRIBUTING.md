# Contributing

This project is security-sensitive and process-sensitive.

## Before You Start

1. Read [README.md](README.md)
2. Read [docs/SECURITY.md](docs/SECURITY.md)
3. Read [docs/AUTH.md](docs/AUTH.md)
4. Run:

```bash
pnpm install
pnpm typecheck
```

## Rules

- do not expose service-role keys in client code
- do not add direct frontend writes to `votes` or `audit_log`
- do not bypass the EC count -> rep verify -> EC release flow
- keep auth changes auditable
- prefer small changes with clear rollout notes

## Checks

At minimum:

```bash
pnpm typecheck
```

If backend auth or voting behavior changed:

```bash
pnpm --filter @suc-vote/api test
```

## Pull Requests

Include:

- what changed
- why it changed
- any SQL or env changes required
- any manual verification steps

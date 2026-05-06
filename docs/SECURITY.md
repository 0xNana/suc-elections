# Security Model

This system separates:

- identity
- voting permission
- ballot access
- result counting
- result release

## Main Principles

### Passwords belong to the user

The Electoral Commission does not set or know user passwords.

- EC issues a one-time activation code
- the user sets a password
- the activation code is burned after use

### Role is not the same as voting permission

Each person has:

- a `role`
- a `can_vote` flag

This allows:

- voter only
- aspirant rep who can vote
- aspirant rep who cannot vote
- EC admin who can vote
- EC admin who cannot vote

### Ballot writes are backend-only

The frontend never writes directly to `votes` or `audit_log`.

### Public results are not automatic

The intended order is:

1. poll closes
2. EC counts results
3. aspirant reps verify
4. EC releases results

### Audit is mandatory

Important actions are logged, including:

- code issuance
- activation
- login
- failed login
- logout
- reset activation
- role change
- poll open
- poll close
- result count
- rep verification
- result release

## Operational Risks

- shared EC credentials reduce accountability
- manual DB edits can bypass procedure
- releasing results before rep verification breaks due process
- demo reset logic should never be used casually in production

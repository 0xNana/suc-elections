# Authentication Flow

This system uses an activation-code flow:

1. The Electoral Commission issues a one-time activation code.
2. The student uses that code to activate their account and set a password.
3. The student signs in with `student_id` and the password they chose.

Passwords are never chosen, seen, or stored by EC members.

## Synthetic Email Mapping

Supabase Auth requires an email address, but users do not sign in with email.

The system maps each `student_id` to a private internal email:

- `SUC2024001` becomes `SUC2024001@suc-vote.internal`

This email is only used internally by Supabase Auth. Users never see it and never use it to sign in.

## For Electoral Commission Members

Use the admin flow to issue activation codes, manage roles, reset activations, set poll times, open or close the poll, count results, and release results.

When you issue activation codes:

- generate the codes
- print or export them
- distribute them securely
- do not store them in personal chat groups or public sheets

If a user loses a code or forgets a password, use `Reset Activation`. That invalidates the old code or old password path and gives the user a fresh activation path.

This system is intentionally designed so that no member of the Electoral
Commission can log in as a student or vote on their behalf. The EC issues
a one-time activation code; the student sets their own password. This
password is never visible to anyone, including system administrators.
This is a deliberate security feature — not a limitation.

## For Students

To start:

1. Get your activation code from the EC.
2. Open the activation page.
3. Enter your Student ID, activation code, and a new password.
4. Save that password. Only you know it.
5. After activation, sign in with your Student ID and password.

Important:

- activation codes work once
- after activation, the code is burned and cannot be reused
- if you lose the code or forget your password, ask the EC to reset activation

## For Aspirant Reps

Aspirant reps use their own activation code and password like every other user.

After the poll closes:

1. Wait for the EC to generate the official count.
2. Review the count shown in the rep dashboard.
3. Submit a verification message if the displayed count matches what you expect.

The audit log helps you verify that:

- codes were issued
- accounts were activated
- logins happened
- resets were triggered
- poll opening and closing actions were recorded
- EC counted and released results in the required order

If you see repeated `RESET_ACTIVATION` events for the same student, treat that as a sensitive event and review it carefully.

## Recommended Supabase Access Token Hook

To keep role and student claims consistent on token issuance, configure a custom access token hook so tokens include:

- `role`
- `student_id`
- `voter_token` as a hashed value

Typical claim shape:

```json
{
  "role": "voter",
  "student_id": "SUC2024001",
  "voter_token": "<hashed_voter_token>"
}
```

Even without the hook, this codebase stores role metadata on the auth user so the backend can enforce role-based access. The hook is still the recommended production setup.

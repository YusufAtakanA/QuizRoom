# ADR 0004: Accounts keeps hosts in memory with plaintext passwords

## Status

accepted, 2026-11-17

## Context

Accounts registers hosts, checks their login and issues JWTs. The project owner decided to keep hosts in memory (`HostStore`, a `ConcurrentHashMap`) and to compare passwords as plain strings, to keep this service small for now.

The requirements say otherwise:

- T03: host accounts must persist across application restarts.
- T04: passwords must be stored as secure hashes.

## Alternatives

- **Database table and a password hash** (for example BCrypt from Spring Security). Meets T03 and T04.
- **In memory with a password hash.** Meets T04, not T03.
- **In memory with plaintext passwords.** Meets neither.

## Decision

By the project owner's explicit decision, Accounts keeps hosts in memory and stores passwords in plaintext.

## Consequences

- This does **not** meet T03 (persistence of host accounts) or T04 (secure password hashes).
- All hosts are lost when Accounts restarts. Their quizzes and results stay in Question Library and Scoring under the old host id, but nobody can log in as that host again: a new registration gets a new id.
- Anyone who can read the Accounts process memory, a heap dump or a debugger session sees every password. Hosts who reuse a password elsewhere are exposed.
- Login still returns the same 401 for an unknown email and a wrong password.

## Review condition

Review before any use outside a local demo, and before submission if T03 or T04 are graded. The check: after a restart of Accounts, can a registered host still log in, and is the stored password a hash?

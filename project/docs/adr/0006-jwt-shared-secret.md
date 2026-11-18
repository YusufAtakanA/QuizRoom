# ADR 0006: HS256 JWTs with one shared secret, plus issuer and audience checks

## Status

accepted, 2026-11-17

## Context

Hosts log in at Accounts and then call Question Library, Live Game Sessions and Scoring. T04 requires a validated token for every protected host operation. Services should not call Accounts on every request.

## Alternatives

- **Asymmetric keys with a JWKS endpoint** (lecture 6.7). Accounts signs with a private key and the other services fetch the public key. A service that can check tokens cannot create them.
- **mTLS between services** (lecture 6.7). Proves which service is calling, but not which host the request is for, so a token is still needed.
- **HS256 with one shared secret.** Every service has `JWT_SECRET` and checks the signature locally.

## Decision

HS256 with one shared `JWT_SECRET` (at least 32 characters) in Accounts, Question Library, Scoring and Live Game Sessions.

Accounts issues tokens with `sub` (host id), `email`, `iat`, `exp`, issuer `iss = "quizroom-accounts"` and audience `aud = ["quizroom-accounts", "quizroom-library", "quizroom-scoring", "quizroom-sessions"]`.

Each service accepts a token only if the signature and expiry are valid, `iss` is `quizroom-accounts`, and `aud` contains its own name:

| Service | Required audience |
|---|---|
| Accounts | `quizroom-accounts` |
| Question Library | `quizroom-library` |
| Scoring | `quizroom-scoring` |
| Live Game Sessions | `quizroom-sessions` |

Otherwise it answers 401, exactly like an invalid token. These values are constants in the code, not configuration.

## Consequences

- No call to Accounts per request; each service checks tokens itself.
- A token signed with the same secret but with another issuer, or without the service's audience, is rejected.
- Every service that can check tokens can also create them, because the same secret signs and verifies. A leak of `JWT_SECRET` from any one service lets an attacker act as any host in every service.
- Changing the secret means restarting all four services together.
- Live Game Sessions forwards the host's token to Question Library and Scoring, which is why one token carries all four audiences.

## Review condition

Review when any service runs on a machine or under an operator that the others do not trust, when a service outside this repository needs to check tokens, or when the secret has to be rotated without restarting every service together.

# Accounts Flow

How a host registers, logs in, and uses the token, and how other services check that token without calling Accounts.

Accounts signs tokens with one shared `JWT_SECRET` (HS256). The other services check tokens with the same secret. The token's `sub` claim holds the host's id, which is how other services know who owns a quiz or a room.

```mermaid
sequenceDiagram
    autonumber
    actor Host
    participant FE as Frontend
    participant AC as AuthController
    participant AS as AccountService
    participant HS as HostStore
    participant JE as JwtEncoder
    participant QL as Question Library

    rect rgba(80,120,200,0.15)
    Note over Host,HS: Registration
    Host->>FE: Fill email, password, display name
    FE->>AC: POST /api/auth/register {email, password, displayName}
    AC->>AC: @Valid check
    alt invalid input
        AC-->>FE: 400 Bad Request
    else valid input
        AC->>AS: register(request)
        AS->>HS: putIfAbsent(email, new Host(id, email, password, displayName))
        alt email already taken
            HS-->>AS: existing Host
            AS-->>AC: throw 409
            AC-->>FE: 409 Conflict
        else email free
            HS-->>AS: null (stored)
            AS-->>AC: HostResponse {id, email, displayName}
            AC-->>FE: 201 Created
        end
    end
    end

    rect rgba(80,200,120,0.15)
    Note over Host,JE: Login
    Host->>FE: Enter email, password
    FE->>AC: POST /api/auth/login {email, password}
    AC->>AS: login(request)
    AS->>HS: get(email)
    HS-->>AS: Host / null
    alt not found or password != stored password
        AS-->>AC: throw 401 "Invalid email or password"
        AC-->>FE: 401 Unauthorized
    else match
        AS->>JE: encode(HS256, {sub=hostId, email, iat, exp})
        JE-->>AS: signed JWT
        AS-->>AC: TokenResponse
        AC-->>FE: 200 OK {accessToken, tokenType, expiresIn}
    end
    end

    rect rgba(200,160,80,0.15)
    Note over FE,HS: Protected request (Accounts)
    FE->>AC: GET /api/accounts/me (Bearer JWT)
    alt token invalid / expired
        AC-->>FE: 401 Unauthorized
    else token valid
        AC->>AS: getHost(jwt.sub)
        AS->>HS: findById(hostId)
        HS-->>AS: Host
        AC-->>FE: 200 OK {id, email, displayName}
    end
    end

    rect rgba(200,80,120,0.15)
    Note over FE,QL: Other services validate token locally
    FE->>QL: GET /api/quizzes (Bearer JWT)
    QL->>QL: verify with shared JWT_SECRET
    alt token invalid
        QL-->>FE: 401 Unauthorized
    else token valid
        QL-->>FE: 200 OK [host's quizzes]
    end
    end
```

## What happens in each block

1. **Registration.** Input is validated, then the host is stored only if the email is not taken yet (`putIfAbsent` makes the check and the insert one step).
2. **Login.** Unknown email and wrong password return the same 401 message, so nobody can find out which emails are registered. On success Accounts returns a signed JWT.
3. **Protected request.** Spring Security checks the token's signature and expiry before the controller runs. The controller reads the host id from `sub`.
4. **Other services.** Question Library, Live Game Sessions, and Scoring verify the same token locally with `JWT_SECRET`. No call to Accounts is needed.

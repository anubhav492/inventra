# Email/password authentication

The `/api/auth` routes use express-session and connect-pg-simple with the existing pg pool and `public.session(sid, sess, expire)` table. Automatic table creation is disabled. The database role needs SELECT/INSERT on public.users and SELECT/INSERT/UPDATE/DELETE on public.session. Email uniqueness uses the existing case-insensitive unique index.

Google sign-in now reuses the same session system; see [GOOGLE_AUTH.md](GOOGLE_AUTH.md) for its manual migration and setup. Google-only users have NULL password_hash and cannot authenticate through local password login. Existing password hashes remain unchanged; matching emails never automatically link accounts. Google initiation/callback GET requests use state/nonce/PKCE protection rather than the Origin policy used for unsafe methods.

## Environment

Keep DATABASE_URL, PORT and NODE_ENV. DEV_USER_ID is obsolete and ignored; it may be removed from local configuration. No actual `.env` values were changed.

| Variable | Setting |
| --- | --- |
| SESSION_SECRET | Required, no default. At least 32 bytes of random secret material. |
| CLIENT_URL | Exact frontend origin, without a path or trailing slash. Defaults to http://localhost:5173 outside production. Production requires an explicit HTTPS origin. |
| NODE_ENV | Use production to enforce HTTPS-only cookies and transport for auth and business APIs. |
| SESSION_SAME_SITE | Optional: lax (default), strict, or none. none requires production HTTPS and is needed for frontend/API on separate sites. |
| TRUST_PROXY | Optional comma-separated trusted proxy IPs/CIDRs or Express named subnets such as loopback. Leave empty for direct TLS. Booleans/hop counts are rejected. |

Generate SESSION_SECRET locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and copy it into `.env`. Do not commit it. Missing/short secrets and invalid origin/cookie configuration fail startup.

Production requires TLS directly or a trusted TLS-terminating proxy forwarding X-Forwarded-Proto: https. Only configure actual trusted proxies, which must overwrite forwarded headers. Untrusted/plain HTTP auth requests receive 400 in production. Cookies use HttpOnly, Path=/, no Domain, seven-day expiry, SameSite=Lax by default, and Secure in production. Cookie names: `inventra.sid` locally, `__Host-inventra.sid` in production. Session lifetime is fixed at seven days, with no rolling or database touch extension. Changing the secret invalidates existing cookies.

CORS allows CLIENT_URL with credentials. Browser clients must use `credentials: 'include'`. SameSite=None remains subject to browser third-party-cookie restrictions.

## API

Every auth POST requires `Content-Type: application/json` and an `Origin` header exactly matching CLIENT_URL, including requests from Thunder Client. Missing/null/foreign/mismatched origins receive 403. The same Origin policy applies to every authenticated unsafe Products, Inventory, Orders and Dashboard request (POST/PATCH/PUT/DELETE). Business authentication runs before Origin validation so anonymous business requests return 401. GET/HEAD do not require Origin. Auth JSON bodies are limited to 16 KiB; existing business body limits and validations are preserved.

| Endpoint | JSON | Success |
| --- | --- | --- |
| POST /api/auth/register | `{"name":"Ada","email":"ada@example.com","password":"correct horse battery staple"}` | 201, public user and a new session cookie |
| POST /api/auth/login | `{"email":"ada@example.com","password":"correct horse battery staple"}` | 200, public user and a regenerated session cookie |
| GET /api/auth/me | None; send cookie | 200, current public user; 401 if unauthenticated |
| POST /api/auth/logout | `{}`; send cookie | 200, destroys session and expires cookie; succeeds if already logged out |

Register/login/me return `{"success":true,"data":{"id":"...","name":"Ada","email":"ada@example.com"}}`. Logout returns `{"success":true,"message":"Logged out"}`. Responses use Cache-Control: no-store. Password hashes and session IDs are never returned in JSON.

Validation trims name (1–150 characters), trims/lowercases email (valid shape, max 254 characters), and rejects extra fields and non-string inputs. Registration passwords need at least 12 characters and at most 1024 UTF-8 bytes. Login accepts existing passwords of 1–1024 bytes. Passwords are never trimmed/normalized. Argon2id parameters are 64 MiB memory, three iterations, one lane. Missing users use a dummy hash; wrong passwords, unknown emails and unsupported/corrupt stored hashes return identical 401 `Invalid email or password` responses.

Duplicate email: 409. Invalid input/JSON: 400. Non-JSON POST: 415. Oversized auth JSON: 413. Session-store failures: safe 503. Database errors use the existing centralized handler. User insertion precedes session creation: a failed session save may leave a registered account; retry login rather than deleting the account.

Login/register share a limit of 10 requests per IP per 15 minutes, including successful requests. All auth endpoints additionally share 120 requests per IP per 15 minutes. Limits return 429 and Retry-After. They use process memory, reset on restart and apply per instance; multi-instance deployments need a shared limiter store or ingress limits.

## Reusable middleware and scope

`requireAuth.js` reloads the user on each protected request, sets only `{id,name,email}` on req.user, and rejects missing/invalid/expired identities and deleted users with 401. Invalid sessions are destroyed and their cookies cleared.

The app shares one `createSessionContext` between auth and business routes. The protected API boundary loads the session, runs requireAuth and checks Origin before entering any business router. Adding a future business group requires adding its prefix to that protected boundary before mounting its handlers. `createApp({config,store})` supports isolated tests; the default app always uses the real existing pg pool and public.session store. Mounting requireAuth without session middleware fails closed.

Products, Inventory, Orders and Dashboard exclusively use req.user.id loaded from the session. The developmentUser middleware and startup validation have been removed. DEV_USER_ID, request headers, query strings and request bodies cannot select an owner. Product/order locks, stock updates, movement inserts, snapshots and nested item reads all retain owner parameters; joins match both resource IDs and owner IDs. Foreign resources return the same 404 as missing ones; foreign movement filters return an empty owned result with zero count. Transaction ordering, arithmetic, stock constraints and business rules are unchanged. Private API responses use Cache-Control: no-store.

## Thunder Client tests (manual only)

Use `http://localhost:5000/api/auth`, enable the cookie jar and use the same hostname throughout. Set Origin to your exact CLIENT_URL and JSON Content-Type on every POST. These manual tests create persistent users/sessions if you run them.

1. GET /me with no cookie → 401.
2. POST /register with the example body and a unique email → 201. Inspect HttpOnly/SameSite cookie; JSON contains only id/name/email. GET /me → 200.
3. Repeat registration with email casing changed → 409. Short password, invalid email, blank name or extra user_id → 400.
4. POST /login with registered credentials → 200 and a different cookie. The old copied session cookie → /me returns 401. Wrong password and unknown email → identical 401.
5. POST /logout with `{}` → 200, expired cookie. GET /me → 401. Repeat logout → 200.
6. Missing Origin or foreign Origin on any POST → 403. text/plain POST → 415. Tampered cookie → /me returns 401.
7. More than 10 login/register attempts per 15 minutes → 429 with Retry-After. Wait for a fresh window for further checks.
8. In a production HTTPS test environment, verify Secure and __Host-inventra.sid. Plain/untrusted HTTP auth → 400. Verify forwarded HTTPS only through the configured trusted proxy.
9. With the saved login cookie, GET /api/products, /api/inventory, /api/orders and /api/dashboard/summary → 200. Without a cookie → 401, regardless of NODE_ENV/DEV_USER_ID. After logout, the saved old cookie also returns 401 on business routes.
10. Use two disposable accounts and resources. Each account sees only its own lists/aggregates. Account A reading/editing/archiving/restocking account B's product or reading/completing/cancelling B's order → 404, identical to a missing UUID. Mixing both owners' product IDs in an order → 404 with no stock deduction. Authenticated writes without the configured Origin → 403.

## Verification

`npm.cmd run check`: 40 JavaScript files checked. `npm.cmd test`: 92 tests, including Google OIDC validation and the existing business rules adapted to signed session cookies. Tests use actual native Argon2, Express sessions, in-memory stores, and the real connect-pg-simple adapter with mocked pool queries. They cover every business endpoint anonymously, deleted/expired/tampered sessions, two-user isolation, foreign/missing resource equivalence, nested joins, aggregates, mixed-owner rollback, and both users' successful order transaction ownership. Auth tests also verify a PostgreSQL-backed login cookie works on business routes and is rejected after logout. No live database reads or mutations were executed by these tests. Live PostgreSQL permissions/schema, true database concurrency and actual TLS proxy connectivity remain manual checks.

Production dependency audit: zero vulnerabilities. Full audit: two moderate advisories in the existing nodemon/minimatch development chain. No unrelated forced upgrades were applied.

Remaining security/operational items: the pg pool does not explicitly enable certificate-validated database TLS, and the existing DATABASE_URL/PGSSLMODE configuration was previously found to have no SSL mode. Configure provider-verified TLS separately. Auth rate limits remain per process and require a shared store or ingress limits for multiple instances. The existing public health endpoint exposes database name/server time; consider restricting its detailed response operationally. The latest production audit, including openid-client, reports zero vulnerabilities. No live database or deployment checks were run for Google sign-in.

References: [Express sessions](https://expressjs.com/en/resources/middleware/session/), [connect-pg-simple](https://github.com/voxpelli/node-connect-pg-simple), [node-argon2](https://github.com/ranisalt/node-argon2), [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit).

# Google sign-in

GET `/api/auth/google` starts Google's OAuth 2.0 Authorization Code Flow with OpenID Connect. GET `/api/auth/google/callback` validates the response and signs the user into the existing PostgreSQL session system. Existing email/password endpoints, requireAuth, business authorization and transaction logic are preserved. This is a sign-in flow, not an account-linking endpoint.

## Manual setup (nothing executed automatically)

1. Review and manually apply [migrations/001_google_identities.sql](migrations/001_google_identities.sql) using your database administration tool. It runs in one transaction, makes users.password_hash nullable and creates account_identities with a `(provider, subject)` primary key, user foreign key, and one Google identity per user. Existing password hashes and the case-insensitive email index are preserved. The SQL is idempotent for the documented schema and is never invoked by app startup, install scripts or tests.
2. The migration enables RLS on account_identities without browser policies. Connect the backend using the table-owner/BYPASSRLS role, or have the administrator install a narrowly scoped server-role policy and grants. Do not expose identity mappings to Supabase anon/authenticated roles. The backend needs SELECT/INSERT on users and account_identities, SELECT/INSERT/UPDATE/DELETE on public.session, and its existing business permissions.
3. Use a Google Cloud OAuth client of type **Web application**. Add the exact authorized redirect URI `http://localhost:5000/api/auth/google/callback`. Configure consent/branding and test users if the Google project is in Testing. Configure the three variables below; they are already present and passed local URL validation in this workspace. No secret values were printed or changed. Google Console registration/credentials were not verified with Google.
4. Keep CLIENT_URL=`http://localhost:5173`, your existing SESSION_SECRET and existing DATABASE_URL. For production use HTTPS for callback/frontend/API, NODE_ENV=production, and trusted TLS-proxy settings as described in AUTH.md. Use SameSite=Lax (default) or None with Secure for separate frontend/API sites. SameSite=Strict prevents the cross-site Google callback and Google initiation fails safely with that setting. Browser third-party-cookie restrictions still apply.
5. Use Node >=22.12.0 and `npm.cmd ci` when installing elsewhere. The backend remains CommonJS and loads the maintained openid-client v6 library using Node's ESM interoperability.

```dotenv
GOOGLE_CLIENT_ID=<Google Web client ID>
GOOGLE_CLIENT_SECRET=<Google Web client secret>
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
```

Open `http://localhost:5000/api/auth/google` as a **top-level browser navigation**, not a frontend fetch request. Keep localhost consistent; do not switch the session cookie to 127.0.0.1. The server redirects to Google and then back to the fixed configured React origin. No React changes were made. A frontend button can later navigate to this endpoint.

## Database assumptions

The existing application SQL assumes public.users has UUID id, name, email, password_hash and created_at (with a database default), plus a case-insensitive unique email index. The migration permits NULL password_hash for new Google-only users; local registration still inserts Argon2id hashes. Local login explicitly rejects users without a stored password and never sets/resets their password.

The existing standard connect-pg-simple table must be public.session with text/varchar sid, JSON/JSONB sess and timestamp expire. The callback atomically removes googleOAuth from this table with a state-and-session-ID predicate before contacting the token endpoint, so replay protection works across server instances. The app reuses its existing pg pool. No live database metadata inspection, writes, migration execution or Google OAuth exchange was run for this change; these assumptions come from the existing backend/schema contract. Review actual schema and role privileges before applying the migration.

New-user creation and identity insertion share the existing transaction helper. An advisory transaction lock serializes creation for a Google subject; database uniqueness handles races with password registrations or other subjects using the same email. Errors roll back the whole user/identity transaction. Registration may commit before session saving fails; retry Google sign-in to resolve the already-created mapping.

## Identity and conflict rules

Only a validated Google ID token can supply identity. The identity mapping key is provider=`google` plus Google's stable `sub`; email is never used as an authentication/linking key. A returning subject resolves its mapped user even if the Google email has changed; stored local name/email are not silently overwritten.

A new subject requires a verified, valid email. If that email already belongs to any existing Inventra user, the flow stops with account_conflict. It never attaches a Google identity to an existing password account or overwrites credentials. The user should use the existing sign-in method. Explicit account linking would require a separately designed flow that authenticates ownership of both accounts; it is not implemented here. No accounts are linked merely because a user happens to be logged in when starting Google sign-in.

## Protocol and session security

- Discovery is pinned to `https://accounts.google.com`, with a ten-second timeout, cached configuration and retries after discovery failure.
- Every initiation generates independent cryptographic state, nonce and a PKCE verifier. S256 is always sent. The verifier/nonce/state live in the server-side session only; state and nonce are also sent to Google as required by the protocol. Attempts expire after ten minutes.
- Callback processing requires the original cookie and exact, single state value. Duplicate critical parameters, expired/missing attempts, provider errors and missing codes fail closed. The session-bound attempt is atomically consumed before exchange, including cancellation/error callbacks. Invalid-state requests do not consume another pending attempt.
- openid-client validates the authorization response, exchanges the code with the PKCE verifier and checks issuer, audience, lifetime and nonce. RS256 is required and `enableNonRepudiationChecks` explicitly verifies the ID-token signature against Google's JWKS. Application validation additionally requires a nonempty bounded subject, verified email and valid email shape.
- Successful sign-in regenerates the existing session ID, sets userId/authenticatedAt and saves before redirecting. No Google tokens are stored in sessions, database mappings, response JSON or redirect URLs. Authenticated business APIs continue to load req.user.id through requireAuth.
- Callback URLs are built from GOOGLE_CALLBACK_URL, never Host/X-Forwarded-Host. Redirect destinations are fixed to CLIENT_URL; returnTo/redirect parameters are ignored. Responses are no-store and Google routes use Referrer-Policy: no-referrer. OAuth failures log only a fixed generic message.
- Auth routes retain their 120 requests/IP/15 minutes overall limit. Google initiation/callback share an additional 20 requests/IP/15 minutes. Existing password login/register limits are unchanged. These limits remain per process.

Success: HTTP 303 to `http://localhost:5173/` (or configured CLIENT_URL).

Failure: HTTP 303 to the same fixed origin with `?auth_error=google_sign_in_failed`, or `?auth_error=account_conflict`. These fixed markers contain no email, tokens, authorization code, error description or secret. Existing middleware failures (such as an unavailable session store or rate limit) retain their safe JSON error behavior. The unchanged React app may not render these markers; inspect the URL when testing failures.

## Manual browser checks

### Diagnosing a generic callback failure

The `google_sign_in_failed` query marker originates in `createGoogleController`'s shared `fail()` handler. It deliberately covers callback validation, atomic session-state consumption, token/ID-token validation, account resolution and final session creation; the redirect alone cannot distinguish these causes. Email conflicts use the distinct `account_conflict` marker.

The server now logs a fixed stage/reason and whitelisted SQLSTATE/OIDC/network codes. Optional accountStage/sessionOperation labels locate individual account queries or session regeneration/saving. JWT diagnostics may include only a whitelisted claim **name**, never its value. A missing-attempt diagnostic reports only whether the cookie name was present, never cookie contents. Error messages, stack traces, provider descriptions, request URLs, codes, tokens, session IDs, secrets and personal data are not logged. Unknown error-code strings are dropped.

Read-only investigation of the configured database confirmed: the identity table exists; users.password_hash is nullable; the backend role has the required table privileges and bypasses RLS on users/account_identities/session; and the session-consume, identity-lookup and advisory-lock statements plan successfully. The session column is JSON, matching the callback cast. No grants, policies, migrations or rows were changed. Public Google discovery and JWKS GET requests also succeeded. These checks do not validate the client secret at the token endpoint.

At inspection time there was one recent, valid-shaped pending OAuth attempt and no Google identity mappings. This makes missing/mismatched session state **before consumption** the leading hypothesis for that observed attempt; it does not prove which stage failed without a fresh server diagnostic.

Restart the running backend to load the diagnostics (or let nodemon reload), open a fresh top-level navigation to `http://localhost:5000/api/auth/google`, finish sign-in within ten minutes, and inspect the backend console. Do not reuse an old callback URL. Share only the structured diagnostic, never callback URLs, cookies, codes or .env contents.

| Diagnostic | Verification/fix |
| --- | --- |
| callback_validation / missing_attempt, requestCookiePresent=false | In browser Network, confirm the initial /google response sets inventra.sid and the callback request includes that cookie name. Use localhost throughout; do not mix 127.0.0.1, private profiles or browsers. Clear only Inventra's stale localhost cookies and retry one fresh flow. Local cookies must use Secure=false and SameSite=Lax. |
| callback_validation / missing_attempt, requestCookiePresent=true | A cookie was sent but no valid attempt was loaded. Check stable SESSION_SECRET across restarts/instances, the expected NODE_ENV/cookie name, one intended backend on port 5000, and the same session database. Retry with a fresh cookie. |
| callback_validation / state_mismatch or expired_attempt | Close parallel/stale sign-in tabs and begin one fresh flow within ten minutes. Do not weaken state/nonce/expiry checks. |
| session_state_consume / attempt_already_consumed | The pending attempt no longer matches an unexpired database session; begin a new flow. Never replay callbacks. |
| token_validation with providerError=invalid_client | Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET belong to the same Google Web application client. Restart after changing environment configuration. Never paste their values into logs/chat. |
| token_validation with providerError=invalid_grant | Verify the Google Console redirect URI exactly matches GOOGLE_CALLBACK_URL and the initial authorization redirect. Use a fresh code/flow. Account selection alone does not prove token exchange succeeded. |
| token_validation with claim=nonce, iss, aud, azp, exp or iat | Check the named validation boundary, fresh state/nonce and correct Google Web client/server clock. Keep signature, nonce, audience and issuer checks enabled. |
| token_validation with network/TLS/timeout code | Check backend access to Google's token and JWKS endpoints and trusted CA/network settings. Do not disable certificate verification. |
| account_resolution with code=42501 | Compare the running process's DATABASE_URL role/permissions with the inspected configuration. Install narrowly scoped server-role grants/policies only after administrator review; do not disable RLS. Current inspected role is not blocked by RLS. |
| account_resolution with accountStage=identity_lookup and code=42P01, or user_insert/23502 | The running process likely targets another database/schema or lacks the expected migration. Inspect its effective database configuration and schema; do not rerun migrations blindly. |
| session_creation with sessionOperation=regenerate or save | Check preceding safe session-store error code, PostgreSQL availability and session-table privileges. Account creation can already have committed; retry Google sign-in instead of deleting the user. |

Diagnostic regression tests cover missing/state-mismatched/consumed attempts, SQL permission/schema errors, token-client rejection, session saving, and redaction of personal data and arbitrary nested errors. Authentication/redirect behavior and security protections are unchanged.

These checks intentionally create real accounts/sessions only when you choose to run them after applying the migration:

1. Sign in with a Google account whose email is new to Inventra. Expect a redirect to localhost:5173, a rotated HttpOnly session cookie, GET /api/auth/me with id/name/email, and successful access to protected APIs using that cookie.
2. Log out and repeat with the same Google account. Expect the same Inventra id and no additional user/identity rows.
3. Use a Google account whose email already belongs to a password account. Expect account_conflict, no mapping, and no password/user changes. Confirm the existing password login still works.
4. Deny consent, remove/change state, clear the cookie before callback or replay a callback. Expect a generic safe failure and no new authentication. Avoid sharing/logging real callback URLs or tokens.
5. Verify Google-only accounts fail local password login with the same generic error as incorrect credentials. Verify logout invalidates access to business APIs.

## Automated verification and limits

`npm.cmd run check`: 40 JavaScript files passed. `npm.cmd test`: 92 tests passed. New HTTP tests use real openid-client validation with locally signed RSA ID tokens, mocked discovery/token/JWKS requests, and mocked PostgreSQL queries/transactions. They cover new/returning users, null passwords, account conflicts and email races, rollback, valid PKCE, invalid state/nonce/issuer/audience/expiry/signatures, missing/expired transactions, consumed callbacks, consent/token/network/discovery failures, fixed redirect destinations, session rotation and session-save failures. Existing auth and cross-user business tests pass unchanged apart from the explicit Google-only local-login rejection case.

No live database mutations, migration execution, Google requests, frontend changes, commits, pushes or deployments occurred. Mocked tests do not prove actual PostgreSQL schema compatibility, RLS permissions, advisory-lock concurrency or Google Console settings. Production dependency audit reports zero vulnerabilities; the existing development dependency advisories remain outside this change. Existing database TLS and multi-instance rate-limit hardening items in AUTH.md still apply.

## Files changed for this feature

- Added migrations/001_google_identities.sql, src/config/google.js, src/services/googleOidc.js, src/services/googleAccounts.js, src/controllers/googleController.js, test/googleAuth.test.js, GOOGLE_AUTH.md.
- Updated src/controllers/authController.js, src/routes/authRoutes.js, src/app.js, test/authApi.test.js, package.json, package-lock.json, .env.example, README.md, AUTH.md, THUNDER_CLIENT.md.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [openid-client](https://github.com/panva/openid-client), [authorization code grant checks](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md).

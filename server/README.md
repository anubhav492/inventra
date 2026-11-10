# Inventra Products API

CommonJS Express controllers and raw parameterized `pg` queries. The existing pool in `src/config/db.js`, GET /, GET /api/health, startup connection check and shutdown handling are retained. No frontend or schema changes were made.

Email/password authentication is available at `/api/auth/register`, `/api/auth/login`, `/api/auth/me` and `/api/auth/logout`. Products, Inventory, Orders and Dashboard require its PostgreSQL session cookie. See [AUTH.md](AUTH.md) for SESSION_SECRET configuration, cookies, Origin protection and Thunder Client tests.

Google sign-in is available at GET `/api/auth/google` and `/api/auth/google/callback`. See [GOOGLE_AUTH.md](GOOGLE_AUTH.md) for the required manual identity migration, Google Console setup, conflict rules and verification. The migration is never executed automatically.

Inventory, Orders and Dashboard now expose 14 additional protected endpoints. See [BUSINESS_API.md](BUSINESS_API.md) for their complete endpoint list, query/response contracts, transaction and concurrency design, executed verification and Thunder Client examples. The Products API documented below remains intact.

## Setup

Use the existing `server/.env` connection configuration. Add:

```dotenv
NODE_ENV=development
SESSION_SECRET=<at-least-32-random-bytes>
CLIENT_URL=http://localhost:5173
```

Generate SESSION_SECRET as documented in AUTH.md. Log in or register using the auth endpoints; all business APIs use that session's user ID. DEV_USER_ID is no longer used. `.env.example` lists configuration keys without credentials.

Run from `server/`:

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd test
```

Every business request loads the session user from PostgreSQL. Missing, invalid, expired and deleted-user sessions return 401. Foreign resource IDs behave like missing resources (404). Unsafe authenticated requests require an Origin exactly matching CLIENT_URL, or return 403. Do not send user_id; identity comes only from the session. Production requires HTTPS and a configured secret; no development-user bypass exists. Root and health routes remain public.

## Implementation

- `src/app.js`: shared session, requireAuth and Origin boundary around all four business route groups.
- `src/routes/productRoutes.js`: route registrations and request ownership guards.
- `src/controllers/productController.js`: scoped queries, validation orchestration, create transaction and product state changes.
- `src/utils/productValidation.js`: UUID, trimmed text, exact decimal, PostgreSQL INTEGER and supported-field validation.
- `src/middleware/authSession.js` and `requireAuth.js`: shared PostgreSQL sessions and current-user verification.
- `src/middleware/errorHandler.js` and `src/utils/databaseErrors.js`: consistent safe errors and identifiable unavailable-database errors.
- `test/`: validation tests and real Express HTTP tests using mocked pg methods; no test database writes.

Every product read/write includes user_id parameters from req.user. Values use $1/$2 placeholders; the only dynamic SQL identifiers/directions come from fixed allowlists. Default list scope is active products ordered by created_at DESC. Explicit status=all includes archived products. Search matches name/SKU case-insensitively; percent, underscore and backslash are treated literally. Repeated/unknown list query parameters are rejected. Sorting has a deterministic ID tie-breaker.

Prices are normalized to exact decimal strings for NUMERIC(12,2) and returned without pg type conversion. Names/SKUs are trimmed and capped at 150/50 characters. Stock/threshold values must be JSON integers from 0 through 2147483647, matching the existing PostgreSQL INTEGER columns. Creation defaults stock to 0 and threshold to 5. Updates cannot edit stock, owner, IDs, timestamps or activity directly. SKU uniqueness follows the database's existing case-sensitive (user_id, sku) constraint, including archived products.

Creation validates first, borrows one pool client, begins a transaction, inserts the product, and inserts INITIAL_STOCK when stock is positive. Both insertions use that same client. The movement records previous=0, new=stock, change=stock, order_id=NULL and Opening stock. The transaction commits only after both succeed; errors trigger rollback and the client is always released. Zero-stock creation does not insert a movement.

PATCH updates include an active-state predicate to prevent edits racing with archive. Archive/restore use conditional state transitions and preserve stock/history. Inaccessible products return the same 404 as missing products.

Errors have `{ "success": false, "message": "..." }`. Validation is 400, missing/inaccessible is 404, duplicate SKU and invalid transitions are 409, unexpected errors are 500, and identifiable database outages are 503. Malformed JSON receives a generic 400 without echoing its contents. SQL, stack traces and connection strings are never returned. Server logs retain error codes/types.

## Verified schema and test limits

The live public.users, public.products and public.stock_movements columns and constraints were inspected read-only. Product ownership, composite product/movement foreign keys, SKU uniqueness and stock movement checks match the SQL used here. No tables or data were changed during inspection.

Automated HTTP tests exercise the actual Express session/auth boundary and routes with mocked pg responses and transaction failures. They verify response handling, two-user isolation, scoped queries, transaction sequencing/release and error paths; they do not prove live PostgreSQL rollback or CRUD execution. Manual CRUD testing requires logging in as the intended owner. See `THUNDER_CLIENT.md` for manual scenarios.

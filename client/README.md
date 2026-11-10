# Inventra frontend

React + Vite + Tailwind workspace with TypeScript API services, authentication state and auth pages. Existing business screens remain JSX and retain their visual design. Products, inventory, orders and dashboard now use the Express/PostgreSQL APIs rather than the old local demo snapshot.

## Local development

Use Node >=22.12. Copy client/.env.example to client/.env if needed:

```dotenv
VITE_API_URL=http://localhost:5000
```

Keep the working server/.env secrets. The backend requires DATABASE_URL, SESSION_SECRET, CLIENT_URL=http://localhost:5173 and PORT=5000. Google sign-in uses the existing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL configuration. VITE_* values are public browser configuration; never put secrets in them. Restart Vite after environment changes.

In separate terminals, from the repository root:

```powershell
cd server
npm.cmd ci
npm.cmd run dev
```

```powershell
cd client
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

Open http://localhost:5173. Keep localhost consistent rather than mixing it with 127.0.0.1. Express already allows the exact CLIENT_URL with credentials and preserves Origin/CSRF protection. Production requires the existing HTTPS/secure-cookie configuration. This change adds no schema migration or automatic migration execution.

## Authentication

Public routes: /#login and /#signup. Protected routes: /#dashboard, /#products, /#inventory, /#orders and /#settings. The provider calls GET /api/auth/me at startup; the workspace does not mount before session verification. A 401 opens login; unavailable/malformed responses show a retry screen. Login/register/logout use the shared credentialed fetch client. Google sign-in uses a full browser navigation to the backend, and the next /me restores the session. OAuth error markers become fixed messages and are removed from the URL.

No session identifiers, credentials, tokens or user records are stored in localStorage/sessionStorage. Backend requireAuth and ownership checks remain authoritative. A business API 401 clears the business cache and rechecks authentication. See server/AUTH.md and server/GOOGLE_AUTH.md for existing backend configuration. Live Google consent remains a manual check.

## Business API integration

See [BUSINESS_API_INTEGRATION.md](BUSINESS_API_INTEGRATION.md) for the full endpoint map, changed files, supported/unsupported controls and manual verification.

- src/services/api.ts centralizes native fetch, credentials: include, JSON, URL/query encoding and ApiError handling.
- src/services/business/ contains typed Products, Inventory, Orders and Dashboard clients plus one authenticated-workspace cache.
- src/hooks/useProducts.js subscribes to that cache once in the workspace. No business screen reads/writes inventoryStorage or seeds data.
- Server-generated IDs, order snapshots, totals, stock and timestamps are canonical. Writes send only whitelisted request fields, never owner IDs or client-computed prices/totals.
- Successful mutations refresh affected loaded views. Loading/error/empty states are distinct. Refresh failure after a committed write reports that the change was saved and avoids repeating it automatically. Network ambiguity is reported without claiming a rollback or retrying the write.
- Older filter responses cannot overwrite newer ones. Logout/account changes unmount and clear the in-memory cache. No server business data is persisted in browser storage.

The old inventoryStorage, demo fixture and pure local-operation helpers remain for their existing regression tests, but are not used by the running application. Old demo data is ignored, not uploaded or deleted. An empty PostgreSQL account displays real empty states.

## Appearance and preferences

src/index.css owns shared light/dark tokens; App.css and existing page styles retain the shell, cards, tables, forms and modal layout. Existing INR formatting and IST dates remain. Dialog focus/keyboard behavior, responsive sidebar, reduced-motion rules, toast notifications, search/filter controls and confirmation steps are retained.

Theme and workspace-name preferences remain browser-local. The workspace name is not a server-side organization/tenant feature. Settings displays the authenticated account and accurately distinguishes server business records from browser preferences. Sign out is available in the header on all protected pages.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:render
npm.cmd run lint
npm.cmd run build
```

Strict TypeScript checks cover all .ts/.tsx code, including business services/cache; existing JSX is checked through lint, build and rendering tests. There are 68 frontend tests, including 14 focused business API/cache tests. The rendering harness exercises actual service/cache code with fake HTTP responses for create/edit/archive/restore, stock receipt, order placement/cancellation/completion, cross-view refreshes, empty/error screens and protected auth views. It asserts that the legacy demo snapshot is never read. All 99 backend tests also pass.

Tests never contact the live database or create real users/products/orders. Browser cookie storage, native modal interaction, multi-account access and real concurrent writes require the manual checks in BUSINESS_API_INTEGRATION.md. Cross-tab changes are fetched on route entry/reload or the next refresh; no push/polling subscription was added.
# Business API integration

Implemented and validated in order: Products, Inventory, Orders, Dashboard. Existing Express endpoints, authentication, database SQL and business transactions were inspected and retained. No backend source, database schema, dependencies, migrations, commits, pushes or deployments were changed.

## Connected endpoints

| Module | Methods and paths | Frontend behavior |
| --- | --- | --- |
| Products | GET /api/products | Full catalog with status=all for summaries/pickers; server-filtered list using search, status, sortBy, sortOrder |
| Products | GET /api/products/:id | Fresh canonical record before editing; missing/foreign IDs show the safe error |
| Products | POST /api/products | Name, SKU, decimal-string price, integer stock_quantity and low_stock_threshold |
| Products | PATCH /api/products/:id | Name, SKU, price and threshold only; never changes stock directly |
| Products | PATCH /api/products/:id/archive; PATCH /api/products/:id/restore | Existing soft removal/restoration with confirmation and authoritative refresh |
| Inventory | GET /api/inventory | Active stock, server search/status/sorting |
| Inventory | GET /api/inventory/alerts | Server-owned low/zero stock alerts |
| Inventory | GET /api/inventory/movements | Product/type filters, server page/limit/total and movement product names/SKUs/order IDs |
| Inventory | POST /api/inventory/:productId/restock | Positive integer quantity and reason |
| Inventory | POST /api/inventory/:productId/adjust | Signed nonzero integer quantity_change and required reason |
| Orders | GET /api/orders | Server UUID search, status, sorting and pagination |
| Orders | GET /api/orders/:id | Historical snapshots, exact unit_price/line_total strings and current order status |
| Orders | POST /api/orders | Only items[{product_id,quantity}]; backend decides prices, totals, ownership and transactional stock deductions |
| Orders | PATCH /api/orders/:id/complete; PATCH /api/orders/:id/cancel | Existing placed-order transitions with confirmation; completion preserves stock, cancellation restores through the backend transaction |
| Dashboard | GET /api/dashboard/summary | Actual all-time product/stock/order/revenue aggregates; also supplies Inventory and Orders summary cards |
| Dashboard | GET /api/dashboard/recent-orders | Five actual latest orders, linked to canonical detail fetch |
| Dashboard | GET /api/dashboard/low-stock | Three actual low/zero-stock products for the existing dashboard card |
| Dashboard | GET /api/dashboard/revenue?period=7d | Server zero-filled IST dates/revenue for the existing seven-day chart |

Every request uses the existing fetch client and credentials: include. Browser Origin is supplied by the browser; no frontend owner IDs, auth tokens or fabricated Origin/Cookie headers are sent. The server's existing CSRF/Origin rules remain enabled.

## Contract adaptations and unsupported controls

- There is no DELETE product endpoint. The frontend retains Archive/Restore; permanent deletion was not invented.
- Products and Inventory lists do not support page/limit. They show the complete filtered server result. Orders and movement history use real server pagination (20/page, Previous/Next, total from PostgreSQL). Status transitions that remove the last matching order correct an out-of-range page.
- The backend has no sequential order_number. Tables, details, notifications and movement links display real UUIDs; no INV-* references are generated.
- Order-list search supports UUID only, not product-name search. List rows expose item_count, not total quantities; unit quantities remain available in order details.
- There is no all-time Active Order Value aggregate. The existing fourth Orders card now displays Completed Revenue from the authoritative dashboard summary, rather than mislabeling a subtotal from the current page as a global value.
- Stock adjustment is a delta, not an absolute count assignment. The existing form/review now asks for a signed quantity change and previews the resulting stock. No unsupported expected_stock field is sent. The preview is advisory; the backend validates current stock under its lock. Absolute compare-and-set stock counts require a separately designed backend contract and are not implemented.
- Editing archived products is disabled until restoration, matching backend rules. SKU uniqueness remains server-controlled and case-sensitive as defined by the existing database constraint.
- Existing theme/workspace-name preferences remain browser-local because there are no corresponding backend settings endpoints. No new date-range or revenue-period UI was added; service query support follows the existing backend while preserving current screen controls.

## Synchronization, errors and data correctness

One store is created for each authenticated workspace mount and keyed by the authenticated account. It keeps server resources in memory only, versions reads to ignore stale responses, and clears the cache on unmount/401. A new account does not reuse the previous account's data. StrictMode cleanup invalidates outstanding reads; no unmounted response can populate the new cache.

There are separate resources for the full catalog, filtered product/stock lists, product details, alerts, paginated movement/order lists, order details, global summary, recent orders, dashboard low-stock rows and revenue. Page entry and form opening fetch relevant data. Mutations serialize within the workspace and wait for the server before refreshing loaded affected resources. New/edited products refresh pickers and inventory; stock operations refresh stock/history/metrics; order placement/cancellation/completion refresh catalog, stock, history, order lists/details and all loaded dashboard resources. No local simulation applies stock transactions.

Existing actual data can remain visible with a Refreshing indicator while a read is in flight. A failed read clears that resource and shows a retryable error, never an empty success or demo fallback. A committed mutation followed by a failed refresh is reported as saved with a refresh warning, not a failed write to repeat. Writes are never automatically retried. A network/server ambiguity warns that the result is unconfirmed and should be checked before repeating the action.

401 clears the cache and restores auth state; 403 displays the safe permission/Origin error without pretending logout; 404 treats foreign and missing resources alike; 409 displays the server's conflict/stock/state message and refreshes canonical data. Other API/network/parse failures remain visible with retry. Error bodies, credentials and tokens are not logged by these services.

Prices remain decimal strings in request/response DTOs. Order details display the backend line_total, not a recalculation using current product prices. Revenue totals sum integer paise with BigInt; floating point is used only for chart geometry/estimated order previews. Inventory and dashboard inventory value use PostgreSQL's exact aggregate. Empty records remain empty, with genuine zero aggregates and server-supplied chart dates, never generated past sales or seeded products.

## Validation performed

- Products: contract/payload/decimal validation, filters/sorting, archive/restore, conflicts, committed-write refresh failures and unauthorized-cache clearing.
- Inventory: actual list/alert/history query parameters, signed payload conversion, pagination, no unsupported fields and related-view refresh.
- Orders: paginated UUID lists, canonical detail snapshots, price/owner stripping, create/complete/cancel paths, stock/history/metric refresh, pagination correction.
- Dashboard: all four endpoints, empty arrays, exact decimal revenue totals, IST labels, invalidation after order/stock mutations.
- Shared: stale response ordering, disposed account caches, duplicate mutation blocking, consistent credentials and no automatic write retry.
- UI rendering harness: actual services/cache with fixture HTTP responses, every screen, canonical product/stock/order workflows, server empty/error states, auth gating and no reads from the old demo snapshot. Existing UI layout/classes are retained.

68 frontend tests, strict TypeScript, lint, the rendering harness and Vite production build pass. All 99 existing backend tests and backend syntax checks pass. No live PostgreSQL mutations or live auth flows were executed. Automated HTTP fixtures do not prove actual browser cookies, PostgreSQL durability, production proxy configuration or true concurrency.

## Manual verification still required

Use an intended disposable development account and run both servers with matching VITE_API_URL/CLIENT_URL. These steps intentionally create persistent development records only when you choose to perform them:

1. Log in with an empty account. All four screens must show real empty states/zero aggregates. Old browser-local sample records must not appear or upload.
2. Add a uniquely named/SKU product with initial stock and a decimal price. Reload and verify persistence; search/filter/sort, edit, archive, restore, and inspect the canonical edit record. Verify duplicate SKU/invalid decimals produce backend errors.
3. Restock and apply a negative adjustment with a reason. Verify the new stock across Products, Inventory, order picker and Dashboard; verify movements (including product/type filters and a second page with enough rows). Test zero change, negative resulting stock and an archived product.
4. Place a multi-product order. Verify server totals/snapshots, stock deductions and movement history after reload. Complete a placed order and check realized revenue. Cancel a different placed order and check exact restoration once. Try insufficient stock or a second transition from another tab; expect a 409 and refreshed data.
5. Create enough orders for pagination, filter/sort/search by UUID and open a detail not on the first page. Verify summaries stay global and are not just page totals. Confirm historical names/prices remain after product edits.
6. Stop/restart the backend and exercise refresh failures. The UI must show errors, never sample rows or false empty success. For a timed-out write, inspect current server records before retrying because backend idempotency keys are not available.
7. Sign out, sign in as a second account, and verify no first-account records remain. Session expiry must return to login. Test denied/foreign/missing IDs and compare generic 404 handling. Check Origin/cookie behavior in an actual browser.
8. Review mobile modal focus, keyboard controls, long UUID table scrolling, and chart/INR rendering. Existing server ownership, RLS and transaction protections remain unchanged. Cross-tab external writes are refreshed on route entry/reload or subsequent refresh; no polling/push system was added. The existing auth provider does not broadcast cross-tab account changes: reload other tabs after switching accounts so their displayed identity/cache is restored from the current cookie.

## Files changed

Added: src/services/business/{common,products,inventory,orders,dashboard,store}.ts, src/services/business.test.js, src/components/ui/RemoteState.jsx, src/components/ui/Pagination.jsx, BUSINESS_API_INTEGRATION.md.

Updated: src/hooks/useProducts.js, src/App.jsx, src/pages/{Products,Inventory,Orders,Dashboard,Settings}.jsx, src/components/forms/{ProductForm,StockForm,OrderForm}.jsx, src/components/inventory/{InventoryAlerts,StockMovementHistory}.jsx, src/components/orders/OrderDetails.jsx, src/components/layout/Sidebar.jsx, scripts/check-render.mjs, README.md.

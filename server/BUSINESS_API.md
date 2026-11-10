# Inventory, Orders and Dashboard API implementation

All endpoints require the existing PostgreSQL session authentication and scope data to req.user.id. Missing/invalid/expired sessions return 401. Authenticated unsafe requests require Origin matching CLIENT_URL, otherwise 403. DEV_USER_ID is ignored and the development-user middleware has been removed. See AUTH.md for cookies, HTTPS configuration and two-account isolation checks. No frontend/schema changes or migrations were made.

## A. Fourteen endpoints

| Module | Method | Path | Behavior |
|---|---|---|---|
| Inventory | GET | /api/inventory | Active owned products, prices, quantities, thresholds and calculated stock_status |
| Inventory | GET | /api/inventory/alerts | Owned active low/zero stock; zero stock first |
| Inventory | GET | /api/inventory/movements | Owned movement history, product names, order IDs, filters and pagination |
| Inventory | POST | /api/inventory/:productId/restock | Add units and create RESTOCK movement together |
| Inventory | POST | /api/inventory/:productId/adjust | Apply signed stock change with reason and ADJUSTMENT movement |
| Orders | GET | /api/orders | Owned orders, item counts, filters, pagination and sorting |
| Orders | GET | /api/orders/:id | Owned order and historical item snapshots with line totals |
| Orders | POST | /api/orders | Place a multi-product order, deduct stock and record history |
| Orders | PATCH | /api/orders/:id/complete | Complete a placed order without changing stock |
| Orders | PATCH | /api/orders/:id/cancel | Cancel a placed order and restore stock once |
| Dashboard | GET | /api/dashboard/summary | Database inventory/order aggregates and completed revenue |
| Dashboard | GET | /api/dashboard/recent-orders | Latest 5 orders by default; optional limit 5–10 |
| Dashboard | GET | /api/dashboard/low-stock | Limited low/zero stock list, zero stock first; default limit 5, maximum 10 |
| Dashboard | GET | /api/dashboard/revenue | Zero-filled completed revenue by IST date; 7d/30d/90d |

### Queries and responses

Inventory list accepts search (name/SKU), status=all|in_stock|low_stock|out_of_stock, sortBy=name|stock_quantity|price, and sortOrder=asc|desc. Defaults: all, name, asc. Archived products are always excluded. SQL wildcard characters in search are literal.

Movements accepts productId, type, startDate, endDate, page and limit. Types are INITIAL_STOCK, RESTOCK, ADJUSTMENT, ORDER_PLACED and ORDER_CANCELLED. Archived product history remains available.

Orders list accepts status=all|placed|completed|cancelled, search (partial order UUID), startDate, endDate, page, limit, sortBy=created_at|total_amount and sortOrder=asc|desc. Defaults: all, created_at, desc. The existing schema has no order_number column; the API uses its real UUID and does not invent sequential references.

Dates must be valid YYYY-MM-DD calendar dates. Start/end dates are inclusive calendar days in Asia/Kolkata; SQL uses an inclusive start and exclusive next-day end. Reversed or impossible ranges return 400. Pagination defaults to page=1, limit=20; limit is capped at 100 and page at 1000000 (out-of-range values are rejected). Pagination total is a decimal string to preserve PostgreSQL COUNT precision. Item counts are distinct order-item rows, not summed units.

Revenue accepts period=7d|30d|90d, default 30d. It includes today in IST and groups by completed_at, not created_at. It returns exactly the requested number of chronological dates, each with a revenue decimal string. Placed/cancelled orders never contribute.

Success responses use {success:true,data:...}; lists also include count, paginated lists include pagination, and revenue includes period/timezone. Empty lists return HTTP 200 and data=[]. Stock operations return data={product,movement}. Order creation/details/transitions return order fields plus items. Historical item unit_price and line_total are decimal strings, including inside aggregated JSON. Monetary aggregates remain PostgreSQL numeric strings. Summary total_stock_units is also a PostgreSQL bigint string; count metrics are integers.

Summary fields: total_active_products, total_stock_units, total_inventory_value, low_stock_count, out_of_stock_count, total_orders, placed_orders, completed_orders, cancelled_orders and total_revenue. Inventory value uses selling prices. Independent inventory/order aggregate CTEs prevent join multiplication, and empty aggregates return zero.

## B. Files

Created:

- src/controllers/inventoryController.js — inventory reads and locked stock operations.
- src/controllers/orderController.js — order reads, validation and transactional lifecycle.
- src/controllers/dashboardController.js — scoped SQL aggregates and revenue series.
- src/routes/inventoryRoutes.js, orderRoutes.js, dashboardRoutes.js — protected route registrations.
- src/utils/apiValidation.js — new endpoint body/query/date/pagination and stock-bound validation.
- src/utils/transaction.js — one-client BEGIN/COMMIT/ROLLBACK/release handling.
- src/utils/money.js — BigInt paise conversion and the actual NUMERIC(12,2) limit.
- src/utils/inventorySql.js — stock-status expressions and movement insertion.
- src/utils/orderSql.js — order row locking and snapshot item reads.
- test/businessValidation.test.js, test/businessApi.test.js — new validation and mocked HTTP/transaction checks.
- scripts/check-syntax.js — recursive JavaScript syntax checks.
- scripts/verify-readonly.js, scripts/read-only-guard.js — real startup and safe GET-only smoke checks.
- BUSINESS_API.md — endpoint, implementation and manual verification guide.

Modified:

- src/app.js — mount the three new routers before 404/error handling.
- src/middleware/errorHandler.js — resource-appropriate database errors for new routes; deadlock/serialization conflicts become retryable 409 responses. Products messages and response structures are retained.
- package.json — expanded syntax checks and optional read-only verification command; no dependencies added.
- README.md — link this guide and document verification.

Products controllers/routes, the PostgreSQL pool, CORS, startup/shutdown logic, health route, secrets and all frontend files are unchanged.

## C. Transactions and concurrency

All new writes use transaction.js and only its dedicated client. BEGIN precedes work; COMMIT follows all successful statements. Any exception triggers ROLLBACK and release in finally. Unavailable/broken clients and failed rollbacks are discarded. No automatic retry risks duplicating an order.

Restock/adjust lock the owned product FOR UPDATE before reading its quantity or archive status. They validate the new quantity within PostgreSQL INTEGER bounds, update one product, and insert one movement on the same client. A failed update or history insertion cannot commit. Adjustment uses a signed delta, not an absolute stock value; negative final stock is rejected.

Order placement validates the entire body before acquiring a client, normalizes UUIDs and rejects duplicates, then locks all owned product rows ORDER BY id FOR UPDATE. Every product's availability, active flag and quantity is checked before the first insertion. Prices come only from locked database rows. BigInt paise arithmetic computes an exact total and rejects totals above NUMERIC(12,2). The transaction inserts the order and immutable name/SKU/price snapshots, deducts all quantities and creates linked ORDER_PLACED movements. A failed statement rolls back the entire order.

Completion locks the owned order first and requires placed status. It updates only status/completed_at and returns the unchanged items. No products or movements are touched.

Cancellation locks the owned order before reading status. It then reads its immutable items and locks affected owned products ORDER BY id FOR UPDATE, including archived products. Every restoration is checked for overflow before any update. Stock is added to current quantities, ORDER_CANCELLED movements are recorded, and status/cancelled_at change in the same transaction. A second cancellation waits for the first order lock and then sees cancelled status, so it is rejected before restoration. Completion/cancellation also serialize on the same order lock. Other stock operations lock products in the same UUID order, preventing request-order lock inversion.

These are real PostgreSQL transactions and locks in implementation, not frontend/localStorage simulations. Actual concurrent write behavior still needs manual or isolated database-backed testing; automated tests below mock the driver.

## D. Validation and errors

- UUIDs: canonical UUID format; input IDs are normalized to lowercase.
- Restock quantity: JSON integer 1..2147483647. Optional nonempty reason, maximum 500 characters; omitted reason defaults to Stock replenishment.
- Adjustment quantity_change: nonzero signed PostgreSQL INTEGER. Required trimmed reason, 3..500 characters. Negative resulting stock and overflow are 409 conflicts.
- Orders: 1..100 distinct products, JSON integer quantities 1..2147483647; unknown fields, client owner IDs/prices/totals, duplicates and unavailable stock are rejected. Order totals cannot exceed 9999999999.99.
- Complete/cancel: no body fields; an omitted body or empty JSON object is accepted.
- Queries: strict parameter allowlists, single string values, valid filter/sort/date/pagination values. Sort identifiers/directions come from fixed code mappings; all user values use SQL parameters.
- Ownership is included in every SELECT/UPDATE and in order-item/product joins. Foreign-key ownership constraints are preserved. Missing/inaccessible products/orders return the same 404.

HTTP codes: 200 for GET/stock actions/transitions, 201 for order creation, 400 for invalid input, 404 for inaccessible/missing records, 409 for stock/state conflicts or database serialization/deadlock conflicts, 500 for unexpected errors, and 503 for recognizable database outages. Error shape is {success:false,message:'...'}. SQL, credentials, stack traces and internal URLs are not returned.

## E. Executed verification and limits

- Read-only inspection confirmed all five live tables, ownership foreign keys, item uniqueness, order timestamp/status checks and stock movement checks. Prices/unit prices/order totals are NUMERIC(12,2).
- Syntax checks cover every JavaScript file in src/, test/ and scripts/.
- 60 automated tests pass: existing Products tests plus new validation, ownership, transaction sequence, rollback, state conflict, stock-bound and dashboard SQL tests. These use the actual Express router with mocked pg responses; no fake records are inserted into the live database.
- The real src/app.js startup path was launched on an isolated port. Root, health, Products, Inventory, movements, Orders, missing-order 404, Dashboard and all three revenue periods passed GET-only live checks.
- The verification process enforces and checks BEGIN READ ONLY per query. A startup-only read-only option was initially ignored by the pooler, and the first harness correctly stopped before endpoint checks. The updated harness works with transaction pooling.
- No live mutation endpoints, database changes, real concurrency tests, frontend connections, commits, pushes or deployments were performed.

Current session integration: 79 automated tests cover existing business rules with signed cookies, every endpoint's anonymous rejection and two-user isolation across reads, joins, aggregates and transactions. The live checks listed above are historical checks from before session integration; they were not rerun for this change.

Commands from server/: npm.cmd run check; npm.cmd test; npm.cmd run verify:readonly. The last command requires database access and verifies public health plus anonymous 401 responses only; it does not create sessions or inspect private user data. There is no separate backend build/lint script.

Remaining operational work: manually test writes with disposable accounts/products/orders and true concurrent requests in an isolated database. The connection/TLS settings were preserved. A prior audit flagged remote database transport hardening; verify certificate-validated TLS with the provider's CA before production. No certificate verification was disabled.

## F. Thunder Client examples

These are instructions, not automatically executed mutations. Log in first, enable the cookie jar and send Origin matching CLIENT_URL on POST/PATCH. Use Content-Type: application/json and actual owned product/order UUIDs returned by the APIs. Do not send user_id. Set baseUrl=http://localhost:5000 (or configured port).

### Restock

POST {{baseUrl}}/api/inventory/{{productId}}/restock

```json
{"quantity":20,"reason":"Supplier shipment"}
```

Expect 200 with updated product and RESTOCK movement containing the real previous/new quantities. Repeat with zero/negative/fractional quantity, archived product, inaccessible UUID and integer overflow to check rejection. Compare before/after via GET inventory and movement history.

### Adjust

POST {{baseUrl}}/api/inventory/{{productId}}/adjust

```json
{"quantity_change":-3,"reason":"Damaged inventory"}
```

Expect 200 when at least three units exist, with ADJUSTMENT change=-3 and accurate previous/new stock. Positive adjustments are also supported. Zero delta, fractional delta, missing reason, negative resulting stock and archived products must fail without a new movement.

### Create order

POST {{baseUrl}}/api/orders

```json
{
  "items":[
    {"product_id":"<actual-product-UUID-1>","quantity":2},
    {"product_id":"<actual-product-UUID-2>","quantity":1}
  ]
}
```

Expect 201 with placed status, exact total_amount, immutable item names/SKUs/unit prices and line totals. Save data.id as orderId. Verify stock decreases and one ORDER_PLACED movement per item. Insufficient stock in any item, duplicate UUIDs (including case variants), archived/inaccessible products and client-supplied prices must reject the whole request.

### Complete order

PATCH {{baseUrl}}/api/orders/{{orderId}}/complete

No body (or {}). Expect 200, status=completed and completed_at set. Stock and movement counts must stay unchanged. Repeating completion or attempting cancellation afterward must return 409.

### Cancel a different placed order

PATCH {{baseUrl}}/api/orders/{{orderId}}/cancel

No body (or {}). Expect 200, status=cancelled and cancelled_at set, restored quantities and ORDER_CANCELLED movements. Repeating cancellation must return 409 with no further stock increase. A product archived after placement should receive its restored quantity without being reactivated.

### Read examples

- GET /api/inventory?search=mouse&status=low_stock&sortBy=stock_quantity&sortOrder=asc
- GET /api/inventory/alerts
- GET /api/inventory/movements?productId={{productId}}&type=ORDER_PLACED&page=1&limit=20
- GET /api/orders?status=placed&sortBy=total_amount&sortOrder=desc&page=1&limit=20
- GET /api/orders/{{orderId}}
- GET /api/dashboard/summary
- GET /api/dashboard/recent-orders?limit=5
- GET /api/dashboard/low-stock?limit=5
- GET /api/dashboard/revenue?period=7d (also test 30d and 90d)

Check zero-filled revenue dates and completed-only totals against manually completed orders. Inventory totals must exclude archived products, and placed/cancelled orders must never contribute to total_revenue. Use startDate/endDate as YYYY-MM-DD for inclusive IST day filtering on orders/movements.

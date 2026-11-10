# Thunder Client: Products API manual checks

First log in/register using [AUTH.md](AUTH.md#thunder-client-tests-manual-only). Enable the cookie jar and send its session cookie on every business request. Set Origin to the exact CLIENT_URL for every POST/PATCH. DEV_USER_ID is ignored.

For Google sign-in, use the browser flow and manual migration described in [GOOGLE_AUTH.md](GOOGLE_AUTH.md). Google authorization requires browser navigation and consent; a Thunder Client request alone does not complete sign-in.

These are manual instructions, not claims that requests have been executed. Configure SESSION_SECRET and CLIENT_URL (see AUTH.md). Start the server from server/ with npm.cmd run dev. Never send user_id, fake JWTs or real credentials to business endpoints.

Create a Thunder Client environment with baseUrl=http://localhost:5000. Use Content-Type: application/json for JSON requests. Replace {{productId}} below with the actual data.id UUID returned by creation; it is not the human-readable SKU. Use a fresh SKU such as TC-MOUSE-20261108-A for this test run. These manual write tests create persistent development data.

## Create response shape

POST {{baseUrl}}/api/products

```json
{
  "name": "Wireless Mouse",
  "sku": "TC-MOUSE-20261108-A",
  "price": "799.00",
  "stock_quantity": 25,
  "low_stock_threshold": 5
}
```

Expected 201:

```json
{
  "success": true,
  "data": {
    "id": "<actual generated UUID>",
    "name": "Wireless Mouse",
    "sku": "TC-MOUSE-20261108-A",
    "price": "799.00",
    "stock_quantity": 25,
    "low_stock_threshold": 5,
    "is_active": true,
    "created_at": "<database timestamp>"
  }
}
```

Save the actual generated UUID as productId. Responses below use that same product.

## Six-endpoint checklist

| # | Request | Body / parameters | Expected result |
|---|---|---|---|
| 1 | POST /api/products | Valid JSON above | 201, success=true, generated UUID, price string, stock=25 |
| 2 | POST /api/products | Repeat exactly the same SKU and body | 409, success=false, duplicate SKU message; no second product/movement |
| 3 | POST /api/products | Same valid fields but fresh SKU and price=-1 | 400, price validation message |
| 4 | POST /api/products | Fresh SKU, price=799, stock_quantity=-1; then repeat with 1.5 and string "25" | 400 each; quantities must be nonnegative JSON integers |
| 5 | GET /api/products | No query parameters | 200, success=true, count and data array; only active products, newest first |
| 6 | GET /api/products | ?search=wireless then ?search=TC-MOUSE-20261108-A | 200; current user's matching name/SKU products only |
| 7 | GET /api/products | ?status=low_stock | 200; active products with 0 < stock <= threshold. Create a second product with stock=3 and threshold=5 if needed |
| 8 | GET /api/products/{{productId}} | None | 200, success=true and data for generated UUID; works when archived too |
| 9 | GET /api/products/<known-unused-valid-UUID> | Generate a UUID and first verify it is absent from your development data | 404, success=false, message="Product not found". Malformed IDs instead produce 400 |
| 10 | PATCH /api/products/{{productId}} | {"name":"Wireless Mouse Pro","price":"999.00"} | 200, returned updated name/price; unchanged stock=25 |
| 11 | PATCH /api/products/{{productId}} | {"stock_quantity":99} | 400, unsupported field; GET confirms stock still 25 |
| 12 | PATCH /api/products/{{productId}}/archive | No body | 200, is_active=false; stock/details/history preserved; omitted from default list |
| 13 | PATCH /api/products/{{productId}}/archive | No body again | 409, message="Product is already archived" |
| 14 | PATCH /api/products/{{productId}}/restore | No body | 200, is_active=true; stock still 25 |
| 15 | PATCH /api/products/{{productId}}/restore | No body again | 409, message="Product is already active" |

For #7, example second creation body:

```json
{"name":"USB-C Hub","sku":"TC-HUB-20261108-A","price":"1899.00","stock_quantity":3,"low_stock_threshold":5}
```

List response example when one product matches:

```json
{"success":true,"count":1,"data":[{"id":"<generated UUID>","name":"Wireless Mouse Pro","sku":"TC-MOUSE-20261108-A","price":"999.00","stock_quantity":25,"low_stock_threshold":5,"is_active":true,"created_at":"<database timestamp>"}]}
```

No matches: HTTP 200 with `{"success":true,"count":0,"data":[]}`.

## 16. Verify stock movement records in PostgreSQL

Run this read-only query in your database SQL editor, replacing both placeholders with the actual returned product UUID and the logged-in user's id from GET /api/auth/me:

```sql
SELECT product_id, user_id, type, order_id, previous_stock,
       new_stock, quantity_change, reason, created_at
FROM public.stock_movements
WHERE product_id = '<actual-generated-product-UUID>'::uuid
  AND user_id = '<authenticated-user-id>'::uuid
ORDER BY created_at;
```

After the first creation, expect one INITIAL_STOCK row with previous_stock=0, new_stock=25, quantity_change=25, order_id=NULL and reason='Opening stock'. Archive, edit and restore must not add or remove movements. A creation with stock_quantity=0 (or omitted) must create no stock movement. A duplicate creation must not add another movement.

## Additional validation and isolation checks

- Test statuses all, active, archived, in_stock, low_stock, out_of_stock.
- Sorting: ?sortBy=price&sortOrder=asc; allowed columns are name, price, stock_quantity, created_at, directions asc/desc.
- Invalid query value, duplicate search parameters or unknown list parameter: 400.
- Prices "1.234", "10000000000.00", null or negative: 400. Maximum valid price: "9999999999.99".
- Empty/oversized name or SKU, unsupported id/is_active/created_at/user_id fields: 400.
- Empty PATCH body, direct threshold decimal, edits while archived: 400/400/409 respectively.
- A product UUID belonging to a different authenticated user must return 404 for GET/PATCH/archive/restore. Use two disposable accounts; do not change someone else's data to prepare this test.
- Missing/expired/tampered session cookies return 401 in all environments. Production uses HTTPS-only cookies. Root/health routes remain public.
- DEV_USER_ID never grants access. Authenticated mutations without exact CLIENT_URL Origin return 403. Logging out invalidates access to business routes too.
- All errors use {"success":false,"message":"..."}; no SQL, stack, password or URL should appear in responses.

The automated tests simulate transaction failure paths with mocked pg clients. They do not inject faults or change constraints in the live database. Do not disable constraints or modify schemas to test rollback manually.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fixture = require('./helpers/sessionFixture')();

let server, base;
before(async () => {
  server = http.createServer(fixture.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test('allowed origin receives credentialed CORS and a Vary header', async () => {
  const response = await fetch(base + '/', { headers: { Origin: fixture.config.clientUrl } });
  assert.equal(response.headers.get('access-control-allow-origin'), fixture.config.clientUrl);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('vary'), /Origin/i);
});

test('JSON preflights support all requested methods without database/session access', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    const response = await fetch(base + '/api/products', { method: 'OPTIONS', headers: {
      Origin: fixture.config.clientUrl, 'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': 'content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), fixture.config.clientUrl);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(response.headers.get('access-control-allow-methods').split(',').includes(method));
    assert.match(response.headers.get('access-control-allow-headers'), /content-type/i);
  }
});

test('a foreign origin is never granted access and auth Origin protection remains active', async () => {
  const foreign = 'https://evil.example';
  const response = await fetch(base + '/', { headers: { Origin: foreign } });
  // CORS is a browser response-access policy; GET may still return 200.
  assert.notEqual(response.headers.get('access-control-allow-origin'), foreign);
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  const write = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: foreign, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(write.status, 403);
  assert.deepEqual(await write.json(), { success: false, message: 'Request origin is not allowed' });
});

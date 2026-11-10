// Runs startup, public health and anonymous protected-GET checks only. Every
// verification connection is forced read-only; no users/sessions are created.
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main() {
  const connection = new URL(process.env.DATABASE_URL);
  const client = new Client({ connectionString: connection.toString(), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const guard = await client.query('SHOW transaction_read_only');
    assert.equal(guard.rows[0].transaction_read_only, 'on');
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['-r', './scripts/read-only-guard.js', 'src/app.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATABASE_URL: connection.toString(),
      NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', TRUST_PROXY: '',
      SESSION_SAME_SITE: 'lax', SESSION_SECRET: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Startup check timed out')), 25000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('Startup process could not launch')); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`Startup process exited with code ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.includes('Inventra API running at')) { clearTimeout(timer); resolve(); }
      });
      // Drain without printing potentially sensitive configuration/connection errors.
      child.stderr.on('data', () => {});
    });
    const checks = [
      ['/', 200], ['/api/health', 200], ['/api/products', 401],
      ['/api/inventory', 401], ['/api/inventory/alerts', 401], ['/api/inventory/movements?limit=1', 401],
      ['/api/orders?limit=1', 401], ['/api/orders/00000000-0000-0000-0000-000000000000', 401],
      ['/api/dashboard/summary', 401], ['/api/dashboard/recent-orders', 401], ['/api/dashboard/low-stock', 401],
      ['/api/dashboard/revenue?period=7d', 401], ['/api/dashboard/revenue?period=30d', 401], ['/api/dashboard/revenue?period=90d', 401],
    ];
    for (const [route, status] of checks) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      assert.equal(response.status, status, `${route}: unexpected HTTP status`);
      if (status === 401) assert.deepEqual(body, { success: false, message: 'Authentication required' });
      console.log(`PASS ${route} -> ${status}`);
    }
    console.log('Read-only live verification passed. No mutation endpoints were called.');
  } finally {
    const exited = () => !child.pid || child.exitCode !== null || child.signalCode !== null;
    if (!exited()) child.kill();
    await new Promise(resolve => { if (exited()) resolve(); else child.once('exit', resolve); });
  }
}
main().catch(error => { console.error('Read-only verification failed:', error.code || error.name, error instanceof assert.AssertionError ? error.message : 'Check database connectivity.'); process.exitCode = 1; });

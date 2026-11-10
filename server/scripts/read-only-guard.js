// Verification-process preload only: never loaded by npm start/dev.
// Poolers may ignore startup options, so enforce READ ONLY per transaction.
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const connect = pool.connect.bind(pool);
pool.connect = async () => { throw new Error('Mutation clients are disabled during read-only verification'); };
pool.query = async (sql, values) => {
  const client = await connect();
  let discard = false;
  try {
    await client.query('BEGIN READ ONLY');
    const mode = await client.query('SHOW transaction_read_only');
    assert.equal(mode.rows[0].transaction_read_only, 'on');
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
};

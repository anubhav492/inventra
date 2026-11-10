const pool = require('../config/db');
const { isDatabaseUnavailable } = require('./databaseErrors');

// Only the supplied client may be used inside the callback.
async function transaction(work) {
  let client, begun = false, discard = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    begun = true;
    const result = await work(client);
    await client.query('COMMIT');
    begun = false;
    return result;
  } catch (error) {
    discard = isDatabaseUnavailable(error);
    if (client && begun) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { discard = true; console.error('Transaction rollback failed:', rollbackError.code || rollbackError.name); }
    }
    throw error;
  } finally {
    if (client) client.release(discard);
  }
}
module.exports = transaction;

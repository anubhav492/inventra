const { randomUUID, createHmac } = require('node:crypto');
const session = require('express-session');
const { readAuthConfig } = require('../../src/config/auth');
const { createApp } = require('../../src/app');

function sessionFixture() {
  const config = readAuthConfig({ NODE_ENV: 'test', SESSION_SECRET: 'test-secret-'.repeat(8), CLIENT_URL: 'http://localhost:5173' });
  const store = new session.MemoryStore();
  const app = createApp({ config, store });
  async function cookie(userId, overrides = {}) {
    const sid = randomUUID();
    await new Promise((resolve, reject) => store.set(sid, {
      cookie: { ...config.cookie, expires: new Date(Date.now() + config.maxAge).toISOString() },
      userId, authenticatedAt: Date.now(), ...overrides,
    }, error => error ? reject(error) : resolve()));
    const signature = createHmac('sha256', config.secret).update(sid).digest('base64').replace(/=+$/, '');
    return `${config.cookieName}=${encodeURIComponent(`s:${sid}.${signature}`)}`;
  }
  return { app, store, config, cookie };
}

module.exports = sessionFixture;

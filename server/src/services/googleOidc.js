const oidc = require('openid-client');
const { readGoogleConfig } = require('../config/google');

function createGoogleOidc({ settings, client = oidc } = {}) {
  let configuration;
  function getSettings() { return settings || (settings = readGoogleConfig()); }
  async function getConfiguration() {
    if (!configuration) {
      const { clientId, clientSecret } = getSettings();
      configuration = client.discovery(new URL('https://accounts.google.com'), clientId,
        { client_secret: clientSecret, id_token_signed_response_alg: 'RS256' },
        client.ClientSecretPost(clientSecret), { timeout: 10, execute: [client.enableNonRepudiationChecks] })
        .catch(error => { configuration = undefined; throw error; });
    }
    return configuration;
  }
  return {
    getSettings,
    async begin() {
      const config = await getConfiguration();
      const attempt = { state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier(), createdAt: Date.now() };
      const url = client.buildAuthorizationUrl(config, {
        response_type: 'code', scope: 'openid email profile', redirect_uri: getSettings().callbackUrl,
        state: attempt.state, nonce: attempt.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(attempt.verifier), code_challenge_method: 'S256',
      });
      return { url: url.href, attempt };
    },
    async authenticate(callback, attempt) {
      const config = await getConfiguration();
      const tokens = await client.authorizationCodeGrant(config, callback, {
        expectedState: attempt.state, expectedNonce: attempt.nonce,
        pkceCodeVerifier: attempt.verifier, idTokenExpected: true,
      });
      // Signature/JWKS, issuer, audience, expiry and nonce are checked by the
      // library, with enableNonRepudiationChecks explicitly requiring signatures.
      return tokens.claims();
    },
  };
}

module.exports = { createGoogleOidc };

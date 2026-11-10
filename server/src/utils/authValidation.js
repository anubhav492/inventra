const { badRequest, validateText } = require('./productValidation');

function validateAuth(body, registration = false) {
  const fields = registration ? ['name', 'email', 'password'] : ['email', 'password'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
    badRequest(`Request body must contain only ${fields.join(', ')}`);
  }
  const email = validateText(body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) badRequest('email must be a valid email address');
  // Never trim or normalize passwords. Cap bytes to bound hashing work.
  if (typeof body.password !== 'string' || body.password.length < (registration ? 12 : 1)
    || Buffer.byteLength(body.password) > 1024) {
    badRequest(registration ? 'password must contain at least 12 characters and at most 1024 bytes' : 'password must contain 1 to 1024 bytes');
  }
  return { email, password: body.password, ...(registration ? { name: validateText(body.name, 'name', 150) } : {}) };
}

module.exports = { validateAuth };

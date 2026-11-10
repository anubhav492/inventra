const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function validateUuid(value, fieldName = "Product ID") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    badRequest(`${fieldName} must be a valid UUID`);
  }
}

function validateText(value, fieldName, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    badRequest(`${fieldName} is required and must be a nonempty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    badRequest(`${fieldName} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function validatePrice(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    badRequest("price is required and must be a valid nonnegative decimal");
  }

  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    badRequest("price must be a valid decimal with at most two decimal places");
  }

  const [integerPart, decimalPart = ""] = raw.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const normalized = `${normalizedInteger}.${decimalPart.padEnd(2, "0")}`;

  const [normalizedIntegerPart] = normalized.split(".");
  if (normalizedIntegerPart.length > 10) {
    badRequest("price is outside the supported NUMERIC(12,2) range");
  }

  return normalized;
}

function validateInteger(value, fieldName, defaultValue) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
    badRequest(`${fieldName} must be a nonnegative integer no greater than 2147483647`);
  }
  return value;
}

function rejectUnsupportedFields(body, allowedFields) {
  const keys = Object.keys(body || {});
  const unsupported = keys.filter((key) => !allowedFields.includes(key));
  if (unsupported.length > 0) {
    badRequest(`Unsupported field(s): ${unsupported.join(", ")}`);
  }
}

module.exports = {
  UUID_PATTERN,
  badRequest,
  validateUuid,
  validateText,
  validatePrice,
  validateInteger,
  rejectUnsupportedFields,
};

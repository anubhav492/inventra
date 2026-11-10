function isDatabaseUnavailable(error) {
  return String(error.code || '').startsWith('08')
    || ['57P01', '57P02', '57P03', '53300', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(error.code)
    || /^(Connection terminated unexpectedly|Connection terminated due to connection timeout|timeout exceeded when trying to connect)/i.test(error.message || '');
}

module.exports = { isDatabaseUnavailable };

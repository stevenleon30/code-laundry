const { retryWithBackoff } = require("smart-retry-backoff-helper");

async function fetchWithRetry(url) {
  return retryWithBackoff(() => fetch(url), { retries: 3 });
}

module.exports = { fetchWithRetry };

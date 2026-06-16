// Input/output validation for TradeFlow AI automations

/**
 * Validates and trims an SMS to the character limit.
 * Throws if the message is blank.
 * @param {string} text - Raw SMS text
 * @param {number} maxLength - Character limit (default 160)
 * @returns {string} Validated text
 */
function validateSms(text, maxLength = 160) {
  if (!text || typeof text !== 'string') throw new Error('SMS text is empty or invalid');
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('SMS text is blank after trimming');
  if (trimmed.length > maxLength) {
    console.warn(`SMS truncated from ${trimmed.length} to ${maxLength} characters`);
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
}

/**
 * Validates an email body. Throws if blank.
 * @param {string} text - Raw email body
 * @param {number} maxWords - Soft word limit for logging
 * @returns {string} Validated text
 */
function validateEmail(text, maxWords = 200) {
  if (!text || typeof text !== 'string') throw new Error('Email body is empty or invalid');
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('Email body is blank after trimming');
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > maxWords) {
    console.warn(`Email is ${wordCount} words — over the ${maxWords}-word guideline`);
  }
  return trimmed;
}

/**
 * Strips any leading/trailing markdown artefacts Claude might produce.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdown(text) {
  return text
    .replace(/^```[\s\S]*?```$/gm, '')
    .replace(/[*_`#]/g, '')
    .trim();
}

/**
 * Basic sanity check on a client config object.
 * @param {object} config
 */
function validateClientConfig(config) {
  const required = ['clientName', 'clientSlug', 'tradeType', 'ownerFirstName', 'phoneNumber'];
  for (const field of required) {
    if (!config[field]) throw new Error(`Client config missing required field: ${field}`);
  }
}

module.exports = { validateSms, validateEmail, stripMarkdown, validateClientConfig };

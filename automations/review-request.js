// Review Booster AI — sends a personalised review request SMS 2–4 hours after job completion
require('dotenv').config();
const { generate } = require('../shared/claude-client');
const { sendSms } = require('../shared/twilio-client');
const { validateSms, stripMarkdown, validateClientConfig } = require('../shared/validators');

/**
 * Handle a job-complete event and send a review request SMS.
 * Call this function after the configured delay (reviewRequestDelayHours) has elapsed.
 * @param {object} event - { customerName, customerPhone, jobType }
 * @param {object} clientConfig - Parsed client config.json
 */
async function handleReviewRequest(event, clientConfig) {
  validateClientConfig(clientConfig);

  if (!clientConfig.smsEnabled) {
    console.log('[review-request] SMS disabled for this client, skipping.');
    return { success: false, reason: 'smsEnabled is false' };
  }

  if (!clientConfig.googleReviewLink) {
    console.error('[review-request] No googleReviewLink in client config.');
    return { success: false, error: 'Missing googleReviewLink' };
  }

  const { customerName, customerPhone, jobType } = event;
  const { clientName, tradeType, ownerFirstName, googleReviewLink } = clientConfig;

  const systemPrompt = `You are the assistant for ${clientName}, a ${tradeType}.
Write a casual, warm SMS from ${ownerFirstName} thanking a customer after completing a job and asking them to leave a Google review.
Return ONLY the SMS text. No markdown. No preamble. The review link will be appended automatically — do NOT include it in your text.
Rules: under 110 characters (the link will be appended), sound like a friendly text from a mate, one ask only, no exclamation marks.`;

  const userMessage = `Customer name: ${customerName}. Job completed: ${jobType}.`;

  let messageText;
  try {
    const raw = await generate(systemPrompt, userMessage, { maxTokens: 80 });
    // Reserve ~30 chars for the review link + space
    const smsBody = `${stripMarkdown(raw)} ${googleReviewLink}`;
    messageText = validateSms(smsBody, 140);
  } catch (err) {
    console.error('[review-request] Claude generation or validation failed:', err.message);
    return { success: false, error: err.message };
  }

  try {
    const result = await sendSms(customerPhone, messageText);
    console.log(`[review-request] SMS sent to ${customerPhone}: "${messageText}"`);
    return { success: true, sid: result.sid, message: messageText };
  } catch (err) {
    console.error('[review-request] Twilio send failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { handleReviewRequest };

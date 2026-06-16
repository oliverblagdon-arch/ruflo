// Missed Call AI — generates and sends a personalised SMS within 60s of a missed call
require('dotenv').config();
const { generate } = require('../shared/claude-client');
const { sendSms } = require('../shared/twilio-client');
const { validateSms, stripMarkdown, validateClientConfig } = require('../shared/validators');

/**
 * Handle a missed call event.
 * @param {object} event - { callerNumber, callerName (optional) }
 * @param {object} clientConfig - Parsed client config.json
 */
async function handleMissedCall(event, clientConfig) {
  validateClientConfig(clientConfig);

  const { callerNumber, callerName } = event;
  const { clientName, tradeType, ownerFirstName, location, phoneNumber } = clientConfig;

  const systemPrompt = `You are the assistant for ${clientName}, a ${tradeType} based in ${location}.
Write a brief, warm SMS to send to a customer who just called but got no answer.
Return ONLY the SMS text. No preamble. No quotes. No markdown.
Rules: under 160 characters, include the business name (${clientName}), offer to call back or book, one exclamation mark maximum, sound like ${ownerFirstName} wrote it himself.`;

  const callerDescription = callerName
    ? `The caller's name is ${callerName} (number: ${callerNumber}).`
    : `The caller's number is ${callerNumber}.`;

  let messageText;
  try {
    const raw = await generate(systemPrompt, callerDescription, { maxTokens: 100 });
    messageText = validateSms(stripMarkdown(raw), 160);
  } catch (err) {
    console.error('[missed-call] Claude generation or validation failed:', err.message);
    // Fallback: do not send a blank SMS
    return { success: false, error: err.message };
  }

  try {
    const result = await sendSms(callerNumber, messageText);
    console.log(`[missed-call] SMS sent to ${callerNumber}: "${messageText}"`);
    return { success: true, sid: result.sid, message: messageText };
  } catch (err) {
    console.error('[missed-call] Twilio send failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { handleMissedCall };

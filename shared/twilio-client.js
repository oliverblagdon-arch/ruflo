// Reusable Twilio SMS wrapper for TradeFlow AI automations
require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

/**
 * Send an SMS. In DRY_RUN mode, logs instead of sending.
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} body - Message text
 * @returns {Promise<object>} Twilio message object or dry-run log
 */
async function sendSms(to, body) {
  if (process.env.DRY_RUN === 'true') {
    console.log('[DRY RUN] SMS would be sent:');
    console.log(`  To: ${to}`);
    console.log(`  Body: ${body}`);
    return { sid: 'dry-run', status: 'dry-run' };
  }

  const twilioClient = twilio(accountSid, authToken);
  const message = await twilioClient.messages.create({ from: fromNumber, to, body });
  console.log(`SMS sent: ${message.sid}`);
  return message;
}

module.exports = { sendSms };

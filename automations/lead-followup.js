// Lead Follow-Up AI — generates and sends a personalised email within 5 minutes of a new enquiry
require('dotenv').config();
const nodemailer = require('nodemailer');
const { generate } = require('../shared/claude-client');
const { validateEmail, stripMarkdown, validateClientConfig } = require('../shared/validators');

/**
 * Handle a new lead enquiry.
 * @param {object} event - { customerName, customerEmail, enquiryText }
 * @param {object} clientConfig - Parsed client config.json
 */
async function handleLeadFollowup(event, clientConfig) {
  validateClientConfig(clientConfig);

  if (!clientConfig.emailEnabled) {
    console.log('[lead-followup] Email disabled for this client, skipping.');
    return { success: false, reason: 'emailEnabled is false' };
  }

  const { customerName, customerEmail, enquiryText } = event;
  const { clientName, tradeType, ownerFirstName, location } = clientConfig;

  const systemPrompt = `You are the assistant for ${clientName}, a ${tradeType} based in ${location}.
Write a short, friendly email reply to a customer who has just sent an enquiry.
Return ONLY the email body text. No subject line. No "Hi [name]:" opener — start with a sentence that acknowledges what they asked about.
Sign off with just "${ownerFirstName}" on the last line.
Rules: under 200 words, reference specifically what the customer asked about, include a soft call to action (offer to visit for a quote or suggest a day), do not use salesy language.`;

  const userMessage = `Customer name: ${customerName}
Their enquiry: ${enquiryText}`;

  let emailBody;
  try {
    const raw = await generate(systemPrompt, userMessage, { maxTokens: 300 });
    emailBody = validateEmail(stripMarkdown(raw), 200);
  } catch (err) {
    console.error('[lead-followup] Claude generation or validation failed:', err.message);
    return { success: false, error: err.message };
  }

  if (process.env.DRY_RUN === 'true') {
    console.log('[DRY RUN] Email would be sent:');
    console.log(`  To: ${customerEmail}`);
    console.log(`  Body:\n${emailBody}`);
    return { success: true, dryRun: true, body: emailBody };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `${clientName} <${clientConfig.emailAddress}>`,
      to: customerEmail,
      subject: `Re: Your enquiry to ${clientName}`,
      text: emailBody,
    });

    console.log(`[lead-followup] Email sent to ${customerEmail}`);
    return { success: true, body: emailBody };
  } catch (err) {
    console.error('[lead-followup] Email send failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { handleLeadFollowup };

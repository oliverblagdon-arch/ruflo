// Reusable Claude API wrapper for TradeFlow AI automations
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate text via Claude API.
 * @param {string} systemPrompt - System-level instructions
 * @param {string} userMessage - The user/trigger content
 * @param {object} options - { model, maxTokens }
 * @returns {Promise<string>} Generated text
 */
async function generate(systemPrompt, userMessage, options = {}) {
  const model = options.model || 'claude-sonnet-4-6';
  const maxTokens = options.maxTokens || 100;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0]?.text?.trim();
  if (!text) throw new Error('Claude returned empty content');
  return text;
}

module.exports = { generate };

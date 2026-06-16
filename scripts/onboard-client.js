#!/usr/bin/env node
// Onboards a new TradeFlow AI client — scaffolds config and prompt folders.
// Usage: node scripts/onboard-client.js
// Runs interactively; completable in under 5 minutes.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` (default: ${defaultValue})` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  console.log('\n=== TradeFlow AI — New Client Onboarding ===\n');

  const clientName = await ask('Business name (e.g. Dave\'s Plumbing)');
  if (!clientName) { console.error('Business name is required.'); process.exit(1); }

  const clientSlug = await ask('Client slug', slugify(clientName));
  const tradeType = await ask('Trade type (e.g. plumber, electrician, roofer)');
  const ownerFirstName = await ask('Owner first name');
  const location = await ask('Location (e.g. Manchester)');
  const phoneNumber = await ask('Business phone number (E.164, e.g. +447700000000)');
  const emailAddress = await ask('Business email address');
  const googleReviewLink = await ask('Google review link (paste from Google Business Profile)');
  const timezone = await ask('Timezone', 'Europe/London');
  const smsEnabled = (await ask('Enable SMS? (yes/no)', 'yes')).toLowerCase() === 'yes';
  const emailEnabled = (await ask('Enable email? (yes/no)', 'yes')).toLowerCase() === 'yes';
  const reviewRequestDelayHours = parseInt(await ask('Review request delay (hours after job complete)', '3'), 10);

  rl.close();

  const config = {
    clientName,
    clientSlug,
    tradeType,
    ownerFirstName,
    location,
    phoneNumber,
    googleReviewLink,
    emailAddress,
    timezone,
    smsEnabled,
    emailEnabled,
    reviewRequestDelayHours,
  };

  const clientDir = path.join(__dirname, '..', 'clients', clientSlug);
  const promptsDir = path.join(clientDir, 'prompts');

  if (fs.existsSync(clientDir)) {
    console.error(`\nError: /clients/${clientSlug}/ already exists. Remove it first if you want to re-onboard.`);
    process.exit(1);
  }

  fs.mkdirSync(promptsDir, { recursive: true });
  fs.writeFileSync(path.join(clientDir, 'config.json'), JSON.stringify(config, null, 2));

  // Copy default prompt templates from the dave-plumbing example
  const templateDir = path.join(__dirname, '..', 'clients', 'dave-plumbing', 'prompts');
  for (const file of ['missed-call.txt', 'lead-followup.txt', 'review-request.txt']) {
    const src = path.join(templateDir, file);
    const dest = path.join(promptsDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      fs.writeFileSync(dest, `# Prompt customisation notes for ${file}\n`);
    }
  }

  console.log(`\n✓ Client "${clientName}" onboarded successfully.`);
  console.log(`  Config:  clients/${clientSlug}/config.json`);
  console.log(`  Prompts: clients/${clientSlug}/prompts/`);
  console.log('\nNext steps:');
  console.log('  1. Review and edit the config.json to confirm all details');
  console.log('  2. Add any tone notes to the prompt .txt files');
  console.log('  3. Wire up the Make.com webhooks with this client\'s slug');
  console.log('  4. Test with DRY_RUN=true before going live\n');
}

main().catch((err) => {
  console.error('Onboarding failed:', err.message);
  process.exit(1);
});

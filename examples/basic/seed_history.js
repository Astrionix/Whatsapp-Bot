const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const readline = require('readline'); // Ensure Import
const path = require('path');
require('dotenv').config(); // Ensure env vars are loaded
// Ideally 'process' is global in Node, but for strict linting/safety:
// const process = require('process');
const supabase = require('./supabaseClient');

const CHAT_FILE = 'chat_history.txt';

// CONFIGURATION: Map names to roles
// Update these to match your chat log EXACTLY
const USER_NAME = 'Ramachandra Reddy';
const ASSISTANT_NAME = 'Chitti Fellow 🤭';

async function importChat() {
  const fileStream = fs.createReadStream(CHAT_FILE);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let records = [];
  const BATCH_SIZE = 50;

  console.log('Starting import...');

  for await (const line of rl) {
    // Regex: [Date, Time] Name: Message
    // Allows for various spaces between Time and AM/PM
    const match = line.match(/^\[(.*?)\]\s*(.*?):\s*(.*)$/);

    if (match) {
      const [_, timestamp, senderRaw, messageRaw] = match;

      const cleanSender = senderRaw
        .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
        .trim();

      let role = null;
      if (cleanSender.includes(USER_NAME)) role = 'user';
      else if (cleanSender.includes(ASSISTANT_NAME)) role = 'assistant';

      // If role not found, maybe skip or log
      if (!role) {
        // console.log('Skipping sender:', cleanSender);
        continue;
      }

      const cleanMessage = messageRaw.trim();
      if (
        !cleanMessage ||
        cleanMessage === 'image omitted' ||
        cleanMessage === 'sticker omitted' ||
        cleanMessage === 'video omitted'
      ) {
        continue;
      }

      records.push({
        phone_number: 'import_history',
        role: role,
        content: cleanMessage,
      });
    } else {
      // console.log('No match:', line.substring(0, 50));
    }

    if (records.length >= BATCH_SIZE) {
      await insertBatch(records);
      records = [];
    }
  }

  if (records.length > 0) {
    await insertBatch(records);
  }

  console.log('Import finished!');
}

async function insertBatch(batch) {
  const { error } = await supabase.from('chat_history').insert(batch);
  if (error) {
    console.error('Insert Error Detail:', JSON.stringify(error, null, 2));
  } else {
    process.stdout.write(`.`); // Progress dot
  }
}

// Removing parseDate as we rely on Default or just string TS if needed.

importChat().catch(console.error);

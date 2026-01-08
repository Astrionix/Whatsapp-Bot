/* eslint-disable */
const wppconnect = require('@wppconnect-team/wppconnect');
require('dotenv').config();
const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const models = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

wppconnect
  .create({
    headless: false,
  })
  .then((client) => start(client))
  .catch((error) => {
    console.log(error);
  });

function start(client) {
  client.onMessage(async (message) => {
    // Ignore group messages
    if (message.isGroupMsg) return;

    // Ignore empty messages or media without caption
    if (!message.body) return;

    const command = message.body.toLowerCase().trim();
    console.log('Received:', message.body);

    // 1. Direct Rule-Based Commands (Fast & Specific)
    if (command === 'hi' || command === 'hai' || command === 'hello') {
      await client.sendText(message.from, 'Hello! 👋');
    } else if (
      command === 'em chesthunaav' ||
      command === 'em chesthunnav' ||
      command === 'em chestunnav'
    ) {
      await client.sendText(
        message.from,
        'Khali ga unna, nuvvu em chesthunnav? 😄'
      );
    }
    // 2. AI Fallback for everything else
    else {
      try {
        const aiReply = await getAIResponse(message.body);
        if (aiReply) {
          await client.sendText(message.from, aiReply);
        }
      } catch (error) {
        console.error('AI Error:', error);
      }
    }
  });

  // Keep session alive
  client.onStateChange((state) => {
    console.log('Connection state:', state);
    if (
      state === 'CONFLICT' ||
      state === 'UNPAIRED' ||
      state === 'UNLAUNCHED'
    ) {
      client.forceRefocus();
    }
  });
}

async function getAIResponse(userMessage) {
  for (const model of models) {
    try {
      // console.log(`Trying model: ${model}`);
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content:
              "You are a casual friend chatting on WhatsApp. Reply with short, simple messages (like 'Khali ga unna...', 'Good n u?', 'Yeah'). Match the user's language and slang. Do NOT act like an AI assistant. Be chill and direct.",
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        model: model,
      });

      return completion.choices[0]?.message?.content || '';
    } catch (e) {
      console.error(`Error with model ${model}:`, e.message);
      // Continue to next model if this one failed
      continue;
    }
  }

  console.error('All backup models failed.');
  return null;
}

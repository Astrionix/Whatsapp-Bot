/*
 * This file is part of WPPConnect.
 *
 * WPPConnect is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * WPPConnect is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with WPPConnect.  If not, see <https://www.gnu.org/licenses/>.
 */
const wppconnect = require('@wppconnect-team/wppconnect');
require('dotenv').config();
const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

wppconnect
  .create({
    headless: true,
  })
  .then((client) => start(client))
  .catch((error) => {
    console.log(error);
  });

function start(client) {
  client.onMessage(async (message) => {
    // Ignore group messages
    if (message.isGroupMsg) return;

    const command = message.body ? message.body.toLowerCase().trim() : '';
    console.log('Received:', message.body);

    // 1. Direct Rule-Based Commands (Fast & Specific)
    if (command === 'hi' || command === 'hai' || command === 'hello') {
      client.sendText(
        message.from,
        'Hello! 👋\nI am connected to Groq AI now. Ask me anything!'
      );
    } else if (command === 'em chesthunaav' || command === 'em chesthunnav') {
      client.sendText(message.from, 'Khali ga unna, nuvvu em chesthunnav? 😄');
    }
    // 2. AI Fallback for everything else
    else {
      try {
        // Show "typing..." state
        // await client.startTyping(message.from);

        const aiReply = await getAIResponse(message.body);

        // Stop typing and send
        // await client.stopTyping(message.from);

        if (aiReply) {
          client.sendText(message.from, aiReply);
        }
      } catch (error) {
        console.error('AI Error:', error);
      }
    }
  });
}

async function getAIResponse(userMessage) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            "You are a helpful, casual, and friendly personal AI assistant on WhatsApp. Always detect the language of the user's message and reply in the EXACT SAME language (and script) that they used. Keep your answers concise, natural, and engaging.",
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      model: 'llama-3.3-70b-versatile',
    });

    return completion.choices[0]?.message?.content || '';
  } catch (e) {
    console.error('Groq API Error:', e);
    return null; // Return null so we don't spam errors to the chat
  }
}

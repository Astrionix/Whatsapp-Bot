/* eslint-disable */
const wppconnect = require('@wppconnect-team/wppconnect');
require('dotenv').config();
const Groq = require('groq-sdk');
const FirecrawlApp = require('@mendable/firecrawl-js').default;
const supabase = require('./supabaseClient');
// const axios = require('axios'); // For Brave Search

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Firecrawl
let firecrawlApp = null;
if (process.env.FIRECRAWL_API_KEY) {
  firecrawlApp = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
}

const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

// Load Advanced Training Data
let tanglishData = [];
try {
  const dataPath = require('path').join(
    __dirname,
    'data',
    'advanced_training_data.json'
  );
  const rawData = require(dataPath);
  tanglishData = rawData.flatMap((category) => category.examples);
  console.log(
    'Loaded Advanced Training Dataset:',
    tanglishData.length,
    'pairs.'
  );
} catch (e) {
  console.error('Failed to load training dataset:', e.message);
}

// === HELPER FUNCTIONS ===

async function saveToDb(userId, role, content) {
  try {
    const { data: recentMessages } = await supabase
      .from('chat_history')
      .select('*')
      .eq('phone_number', userId)
      .eq('role', role)
      .eq('content', content)
      .gt('created_at', new Date(Date.now() - 60000).toISOString());

    if (recentMessages && recentMessages.length > 0) return;

    await supabase
      .from('chat_history')
      .insert([{ phone_number: userId, role, content }]);
  } catch (err) {
    console.error('DB Error:', err);
  }
}

async function getChatHistory(userId, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('chat_history')
      .select('role, content')
      .eq('phone_number', userId)
      .order('id', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data.reverse();
  } catch (err) {
    return [];
  }
}

// Helper: Firecrawl Search
async function searchWeb(query) {
  try {
    if (!firecrawlApp) return null;

    console.log(`Searching Firecrawl: ${query}`);
    // Search for 3 results and get markdown content
    const searchResponse = await firecrawlApp.search(query, {
      pageOptions: { onlyMainContent: true },
      limit: 3,
    });

    if (!searchResponse.success || !searchResponse.data) return null;

    // Summarize the top result into a context block
    const snippets = searchResponse.data
      .map(
        (r) => `Title: ${r.title}\nContent: ${r.markdown?.substring(0, 300)}...`
      )
      .join('\n\n');
    return snippets;
  } catch (e) {
    console.error('Firecrawl search failed:', e.message);
    return null;
  }
}

// === CORE AI LOGIC ===

async function getAIResponse(userId, userMessage) {
  // 1. Fetch Context
  const history = await getChatHistory(userId, 6);

  // 2. SEARCH CHECK: Does user need real-time info?
  let searchContext = '';
  if (firecrawlApp) {
    try {
      const toolCheck = await groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are a Smart Classifier.
                 
                 YOUR GOAL: PREVENT unnecessary Google Searches. Default to "NO".
                 
                 RULES:
                 1. Return "NO" for personal questions ("How is life?", "Life is sad", "What are you doing?").
                 2. Return "NO" for ambiguous terms unless "MOVIE", "RATING", "SCORE" is explicitly said.
                    - "Life ela undi" -> NO (It means "How is life?", not a movie).
                    - "Orange ela undi" -> NO (Likely asking about fruit or color, unless 'Orange Movie' is said).
                 3. Return "SEARCH: <query>" ONLY for explicit info requests (News, Ratings, Scores).
                 
                 Ex: "Life ela undi" -> NO
                 Ex: "Kalki rating" -> SEARCH: Kalki movie rating
                 ` },
                 { role: 'user', content: userMessage }
             ],
             model: 'llama-3.1-8b-instant'
         });
         const decision = toolCheck.choices[0]?.message?.content || "NO";
         console.log(`[Classifier] User: "${userMessage}" -> Decision: "${decision}"`);
         
         if (decision.startsWith("SEARCH:")) {
             const query = decision.replace("SEARCH:", "").trim();
             const searchResults = await searchWeb(query);
             if (searchResults) {
                 searchContext = `\nREAL-TIME INFO (Firecrawl):\n${searchResults}\n`;
             }
         }
     } catch(e) { console.error("Tool check failed", e); }
  }

  // PASS 1: CORE INTENT
  const intentMessages = [
     ...history,
     { role: 'user', content: userMessage },
     { role: 'system', content: `You are an AI friend. Reply with the raw intent.${searchContext} Keep it short. Intent:` }
  ];
  
  let rawIntent = "";
  try {
     const intentCompletion = await groq.chat.completions.create({
        messages: intentMessages,
        model: 'llama-3.1-8b-instant', 
     });
     rawIntent = intentCompletion.choices[0]?.message?.content || "";
  } catch(e) { /* ignore */ }

  // PASS 2: TRANSLATOR (Draft)
  const translatorSystemPrompt = `
  You are a 'Tanglish Translator' from Hyderabad. 
  Rewrite the input 'Intent' into 100% Native, Casual Hyderabad Tanglish.
  Strategy: Identify emotion, Pick slang (Mowa, Ra, Bokka), Sound like a text.
  Safety: No vulgar words.
  Input: "${rawIntent}" -> Output: 
  `;

  // Dynamic RAG Examples
  let randomExamples = [];
  if (tanglishData.length > 0) {
      randomExamples = tanglishData
        .sort(() => 0.5 - Math.random())
        .slice(0, 5)
        .map(pair => [
          { role: 'user', content: pair.user },
          { role: 'assistant', content: pair.assistant }
        ])
        .flat();
  }
  
  let draftReply = "";
  try {
     const draftCompletion = await groq.chat.completions.create({
        messages: [
            { role: 'system', content: translatorSystemPrompt },
            ...randomExamples,
            { role: 'user', content: `Intent: "${rawIntent}"` }
        ],
        model: 'llama-3.1-8b-instant', 
     });
     draftReply = draftCompletion.choices[0]?.message?.content || "";
  } catch(e) { console.error("Draft failed", e); }

  // PASS 3: THE CRITIC (Final Polish)
  const criticPrompt = `
  You are 'Mass Raja', a strict Hyderabad slang expert.
  Review the 'Draft Reply'.
  
  CHECKLIST:
  1. If it sounds like a translation -> FIX IT.
  2. If it is too long -> SHORTEN IT.
  3. If it lacks 'flavor' -> Add 'mowa', 'ra', 'bokka', 'le'.
  4. KEEP THE MEANING SAME.
  
  Draft: "Nenu bagunnanu" -> Fix: "Super unna mowa"
  Draft: "Varsham paduthundi" -> Fix: "Bibatsham ga varsham padtundi"
  Draft: "Output: Thintunna" -> Fix: "Thintunna ra"
  
  Correct the Draft: "${draftReply}"
  `;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'system', content: criticPrompt }],
        model: model, // Best model for Final Polish
      });

      let finalReply = completion.choices[0]?.message?.content || '';
      return finalReply.replace(/^["']|["']$/g, '');
    } catch (e) {
      continue;
    }
  }
  return null;
}

// === MAIN BOT START ===

wppconnect
  .create({
    headless: true,
    logQR: true,
    autoClose: 600000,
    catchQR: (base64Qr, asciiQR) => {
      console.log('QR Code received');
      const matches = base64Qr.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches.length !== 3) return;
      const data = Buffer.from(matches[2], 'base64');
      require('fs').writeFile('qrcode.png', data, 'binary', (err) => {
        if (err) console.error(err);
        else console.log('QR Code saved to qrcode.png');
      });
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  .then((client) => start(client))
  .catch((error) => console.log(error));

function start(client) {
  client.onMessage(async (message) => {
    if (message.isGroupMsg || !message.body) return;
    const command = message.body.toLowerCase().trim();
    console.log('Received:', message.body);
    await saveToDb(message.from, 'user', message.body);

    if (['hi', 'hai', 'hello'].includes(command)) {
      const reply = 'Hello! 👋';
      await client.sendText(message.from, reply);
      await saveToDb(message.from, 'assistant', reply);
    } else {
      const aiReply = await getAIResponse(message.from, message.body);
      if (aiReply) {
        await client.sendText(message.from, aiReply);
        await saveToDb(message.from, 'assistant', aiReply);
      }
    }
  });
}

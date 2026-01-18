const Groq = require('groq-sdk');
require('dotenv').config();
const fs = require('fs'); // Added fs
const path = require('path'); // Added path
const supabase = require('./supabaseClient');

// Mock WPPConnect/Index functions for testing
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Load Advanced Dataset (Mirroring index.js)
// Using path.join for robust file path handling
const dataPath = path.join(__dirname, 'data', 'advanced_training_data.json');
const rawDataset = require(dataPath);
const dataset = rawDataset.flatMap((c) => c.examples);

// We need to copy the *exact* logic from index.js to test it accurately.
// For the sake of this test script, I will duplicate the getAIResponse logic here
// ensuring it mirrors index.js exactly.

async function getTestAIResponse(userMessage) {
  // 1. Mock History
  const history = [];

  // PASS 1: Generate the Core Intent (English/Simple Tanglish)
  const intentMessages = [
    ...history,
    { role: 'user', content: userMessage },
    {
      role: 'system',
      content:
        "You are an AI friend. Reply with the raw intent of your answer in simple English. Keep it super short. Example: If user says 'Tinnava', intent is 'Yes eating'.",
    },
  ];

  let rawIntent = '';
  try {
    const intentCompletion = await groq.chat.completions.create({
      messages: intentMessages,
      model: 'llama-3.1-8b-instant',
    });
    rawIntent = intentCompletion.choices[0]?.message?.content || '';
  } catch (e) {
    /* ignore */
  }

  // PASS 2: The "Hyderabad Slang Translator"
  const translatorSystemPrompt = `
    You are a 'Tanglish Translator' from Hyderabad. 
    Your ONLY job is to rewrite the input 'Intent' into 100% Native Hyderabad Tanglish.
    
    RULES:
    - NO robotic words.
    - USE: 'Mowa', 'Ra', 'Le', 'Kada', 'Enti', 'Bokka'.
    - Short & Punchy.
    
    EXAMPLES:
    Input: "I am eating" -> Output: "Thintunna mowa"
    Input: "I don't know" -> Output: "Telidu ra naku"
    Input: "Go to sleep" -> Output: "Paduko inka"
    Input: "No money" -> Output: "Rupayi ledu pocket lo"
    Input: "Yes correct" -> Output: "Avunu kada"
    Input: "${rawIntent}" -> Output: 
    `;

  const finalMessages = [
    { role: 'system', content: translatorSystemPrompt },
    {
      role: 'user',
      content: `Context: User said "${userMessage}". Intent to reply: "${rawIntent}". Rewrite this intent in Tanglish:`,
    },
  ];

  try {
    const completion = await groq.chat.completions.create({
      messages: finalMessages,
      model: 'llama-3.3-70b-versatile',
    });
    let finalReply = completion.choices[0]?.message?.content || '';
    finalReply = finalReply.replace(/^["']|["']$/g, '');
    return finalReply;
  } catch (e) {
    return '';
  }
}

async function gradeResponse(input, output) {
  const prompt = `
    You are a Telugu/Tanglish Linguistic Judge.
    Input: "${input}"
    Bot Reply: "${output}"

    Rate the Bot Reply on 1-10 scale for "Natural Tanglish Authenticity".
    - 10: Perfect casual friend (e.g., "Avuna mowa", "Thintunna")
    - 1: Too formal / English / Hindi / Tamil mixing (e.g., "Did you eat?", "Bhojanam chesara")

    Return ONLY a JSON: {"score": number, "reason": "short explanation"}
    `;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      response_format: { type: 'json_object' },
    });
    return JSON.parse(completion.choices[0]?.message?.content);
  } catch (e) {
    return { score: 0, reason: 'Error grading' };
  }
}

async function runTest() {
  console.log('Starting Advanced Accuracy Test (100 Messages)...');
  const results = [];
  let totalScore = 0;

  // Pick 95 random inputs from dataset
  const testCases = [];
  for (let i = 0; i < 95; i++) {
    const randomPair = dataset[Math.floor(Math.random() * dataset.length)];
    testCases.push(randomPair.user);
  }

  // Add 5 Specific SEARCH Testing Questions
  testCases.push('Who is python developer?');
  testCases.push('Today cricket match score?');
  testCases.push('Kalki movie rating?');
  testCases.push('Hyderabad weather today');
  testCases.push('Bitcoin price entha?');

  for (const [index, input] of testCases.entries()) {
    process.stdout.write(`TestCase ${index + 1}/100: "${input}"... `);

    try {
      const reply = await getTestAIResponse(input);
      const grading = await gradeResponse(input, reply);

      totalScore += grading.score;
      results.push({
        input,
        reply,
        score: grading.score,
        reason: grading.reason,
      });
      console.log(`[${grading.score}/10] -> ${reply}`);
    } catch (e) {
      console.log('Error', e);
    }
  }

  const avg = totalScore / results.length;
  console.log(`\n\nFINAL ADVANCED ACCURACY SCORE: ${avg.toFixed(2)} / 10`);

  // Save Report
  const fs = require('fs');
  let report = `# Advanced Tanglish Bot Accuracy Report\n**Average Score:** ${avg.toFixed(
    2
  )}/10\n\n| Input | Bot Reply | Score | Reason |\n|---|---|---|---|\n`;
  results.forEach((r) => {
    report += `| ${r.input} | ${r.reply} | ${r.score} | ${r.reason} |\n`;
  });
  fs.writeFileSync('accuracy_report_100.md', report);
  console.log('Report saved to accuracy_report_100.md');
}

runTest();

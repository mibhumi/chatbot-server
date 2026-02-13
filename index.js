let express = require('express');
let cors = require('cors');
let { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
let app = express();
app.use(cors());
app.use(express.json()); // allow front end api json data

let genAI = new GoogleGenerativeAI(process.env.KEY);
let model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

async function generateReplyWithRetries(prompt, opts = {}) {
  const maxAttempts = opts.maxAttempts || 4;
  const baseDelay = opts.baseDelay || 500; // ms

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      // Prefer result.response.text() if present
      if (result?.response?.text) return result.response.text();
      if (result?.output?.[0]?.content) return result.output[0].content;
      if (result?.candidates?.[0]?.output) return result.candidates[0].output;
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      const status = err?.status || err?.code || (err?.response?.status);

      // If rate limited (429) or server error (5xx), retry with backoff
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxAttempts) {
        // rethrow the error if not retryable or out of attempts
        throw err;
      }

      // Exponential backoff with jitter
      const jitter = Math.floor(Math.random() * 100);
      const delay = Math.pow(2, attempt - 1) * baseDelay + jitter;
      console.warn(`AI call failed (attempt ${attempt}) — retrying in ${delay}ms`, err?.message || err);
      await new Promise((r) => setTimeout(r, delay));
      // then loop to retry
    }
  }
}

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const reply = await generateReplyWithRetries(message, { maxAttempts: 4, baseDelay: 500 });
    res.json({ response: reply });
  } catch (err) {
    console.error('Failed to generate reply:', err);

    // If the error includes rate-limit info, surface a friendly message
    const status = err?.status || err?.code || (err?.response?.status);
    if (status === 429) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
      return;
    }

    res.status(500).json({ error: 'Failed to generate response' });
  }
});

const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
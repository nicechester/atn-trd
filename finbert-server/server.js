import express from 'express';
import { pipeline, env } from '@xenova/transformers';

// Use local model path if set, otherwise download from HuggingFace
const modelPath = process.env.FINBERT_MODEL_PATH || 'ProsusAI/finbert';
if (process.env.FINBERT_MODEL_PATH) {
  env.localModelPath = process.env.FINBERT_MODEL_PATH;
  env.allowRemoteModels = false;
}

const app = express();
app.use(express.json());

let classifier;

async function init() {
  console.log(`Loading model from ${modelPath}...`);
  classifier = await pipeline('sentiment-analysis', modelPath);
  console.log('Model loaded');
}

function normalizeScore(label, score) {
  if (label === 'positive') return score;
  if (label === 'negative') return -score;
  return 0;
}

app.post('/analyze', async (req, res) => {
  const { text } = req.body;
  const [result] = await classifier(text);
  res.json({
    label: result.label,
    score: result.score,
    normalizedScore: normalizeScore(result.label, result.score)
  });
});

app.post('/analyze/batch', async (req, res) => {
  const { texts } = req.body;
  const results = await classifier(texts);
  res.json(results.map(r => ({
    label: r.label,
    score: r.score,
    normalizedScore: normalizeScore(r.label, r.score)
  })));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 5000;
init().then(() => {
  app.listen(port, () => console.log(`FinBERT server on port ${port}`));
});

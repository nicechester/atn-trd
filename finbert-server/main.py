"""FinBERT sentiment analysis microservice using ONNX runtime."""

import os
import numpy as np
import onnxruntime as ort
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer

app = FastAPI()

model_path = os.environ.get("FINBERT_MODEL_PATH", "/models/finbert-onnx")
tokenizer = AutoTokenizer.from_pretrained(model_path)
session = ort.InferenceSession(os.path.join(model_path, "model.onnx"))

LABELS = ["positive", "negative", "neutral"]


def softmax(x):
    e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return e_x / e_x.sum(axis=-1, keepdims=True)


def predict(texts: list[str]) -> list[dict]:
    inputs = tokenizer(texts, padding=True, truncation=True, return_tensors="np")
    outputs = session.run(None, {k: v for k, v in inputs.items()})
    probs = softmax(outputs[0])
    results = []
    for prob in probs:
        idx = int(np.argmax(prob))
        label = LABELS[idx]
        score = float(prob[idx])
        normalized = score if label == "positive" else (-score if label == "negative" else 0)
        results.append({"label": label, "score": score, "normalizedScore": normalized})
    return results


class TextRequest(BaseModel):
    text: str


class BatchRequest(BaseModel):
    texts: list[str]


class SentimentResult(BaseModel):
    label: str
    score: float
    normalizedScore: float


@app.post("/analyze")
def analyze(req: TextRequest) -> SentimentResult:
    result = predict([req.text])[0]
    return SentimentResult(**result)


@app.post("/analyze/batch")
def analyze_batch(req: BatchRequest) -> list[SentimentResult]:
    results = predict(req.texts)
    return [SentimentResult(**r) for r in results]


@app.get("/health")
def health():
    return {"status": "ok"}

"""FinBERT sentiment analysis microservice using ONNX runtime."""

import os
from fastapi import FastAPI
from pydantic import BaseModel
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer, pipeline

app = FastAPI()

# Use local model path if available
model_path = os.environ.get("FINBERT_MODEL_PATH", "/models/finbert-onnx")
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = ORTModelForSequenceClassification.from_pretrained(model_path)
classifier = pipeline("sentiment-analysis", model=model, tokenizer=tokenizer)


class TextRequest(BaseModel):
    text: str


class BatchRequest(BaseModel):
    texts: list[str]


class SentimentResult(BaseModel):
    label: str
    score: float
    normalizedScore: float


def to_result(r: dict) -> SentimentResult:
    label = r["label"].lower()
    score = r["score"]
    normalized = score if label == "positive" else (-score if label == "negative" else 0)
    return SentimentResult(label=label, score=score, normalizedScore=normalized)


@app.post("/analyze")
def analyze(req: TextRequest) -> SentimentResult:
    result = classifier(req.text)[0]
    return to_result(result)


@app.post("/analyze/batch")
def analyze_batch(req: BatchRequest) -> list[SentimentResult]:
    results = classifier(req.texts)
    return [to_result(r) for r in results]


@app.get("/health")
def health():
    return {"status": "ok"}

-- Add FinBERT sentiment scoring columns to assessments table

ALTER TABLE assessments ADD COLUMN sentiment_summary TEXT;
ALTER TABLE assessments ADD COLUMN finbert_score REAL;
ALTER TABLE assessments ADD COLUMN finbert_label TEXT CHECK(finbert_label IN ('positive', 'negative', 'neutral'));
ALTER TABLE assessments ADD COLUMN finbert_confidence REAL;

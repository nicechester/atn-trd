FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy version first for label
COPY VERSION .
ARG VERSION
LABEL version=${VERSION:-1.0.0}

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Model will be mounted from host at /models/finbert
ENV TRANSFORMERS_CACHE=/models

COPY main.py .

EXPOSE 5000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]

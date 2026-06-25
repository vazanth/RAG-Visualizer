FROM python:3.11-slim

WORKDIR /app

# Set Hugging Face cache directory to a build-in writeable directory
ENV HF_HOME=/app/.cache/huggingface
# Tell NLTK where to find downloaded data
ENV NLTK_DATA=/app/nltk_data

# Install system deps for numpy/umap
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python deps
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Pre-download NLTK data at build time to the app-owned directory
RUN mkdir -p /app/nltk_data && \
    python -c "import nltk; nltk.download('punkt', download_dir='/app/nltk_data'); nltk.download('punkt_tab', download_dir='/app/nltk_data'); nltk.download('stopwords', download_dir='/app/nltk_data')"

# Pre-download HF embedding models at build time
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True); \
    SentenceTransformer('google/gemma-3n-embedding-exp', trust_remote_code=True); \
    SentenceTransformer('Qwen/Qwen3-Embedding-0.6B', trust_remote_code=True)"

# Pre-download HF Qwen LLM model at build time
RUN python -c "from transformers import AutoTokenizer, AutoModelForCausalLM; \
    AutoTokenizer.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct'); \
    AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct')"

# Copy app code
COPY . .

# Grant full read/write/execute permissions on /app for non-root containers in Hugging Face
RUN chmod -R 777 /app

# HF Spaces expects port 7860
EXPOSE 7860

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]

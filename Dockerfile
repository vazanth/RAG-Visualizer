FROM python:3.11-slim

WORKDIR /app

ENV HF_HOME=/app/.cache/huggingface
ENV NLTK_DATA=/app/nltk_data

# Install system deps for numpy/umap/llama-cpp
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Pre-download NLTK data
RUN mkdir -p /app/nltk_data && \
    python -c "import nltk; nltk.download('punkt', download_dir='/app/nltk_data'); nltk.download('punkt_tab', download_dir='/app/nltk_data'); nltk.download('stopwords', download_dir='/app/nltk_data')"

# Pre-download public HF embedding models
RUN python -c "from huggingface_hub import snapshot_download; \
    snapshot_download(repo_id='nomic-ai/nomic-embed-text-v1.5'); \
    snapshot_download(repo_id='Qwen/Qwen3-Embedding-0.6B')"

# Download lightweight GGUF model instead of raw safetensors
RUN mkdir -p /app/models && \
    python -c "from huggingface_hub import hf_hub_download; \
    hf_hub_download(repo_id='Qwen/Qwen2.5-1.5B-Instruct-GGUF', filename='qwen2.5-1.5b-instruct-q4_k_m.gguf', local_dir='/app/models')"

COPY . .

RUN chmod -R 777 /app

EXPOSE 7860

# Force unbuffered Python output so you can actually see error logs in HF Spaces
CMD ["python", "-u", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
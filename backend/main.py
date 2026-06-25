import os
import nltk
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


def initialize_nltk():
    nltk_data_dir = os.environ.get("NLTK_DATA", os.path.expanduser("~/nltk_data"))
    os.makedirs(nltk_data_dir, exist_ok=True)

    if nltk_data_dir not in nltk.data.path:
        nltk.data.path.append(nltk_data_dir)


    resources = {
        "tokenizers/punkt": "punkt",
        "tokenizers/punkt_tab": "punkt_tab",
        "corpora/stopwords": "stopwords",
    }

    for path, package in resources.items():
        try:
            nltk.data.find(path)
            print(f"Found NLTK resource: {package}")
        except LookupError:
            print(f"Downloading missing NLTK resource: {package} to {nltk_data_dir}...")
            nltk.download(package, download_dir=nltk_data_dir)


initialize_nltk()

from backend.routers.retrieval_router import router as retrieval_router
from backend.routers.chunk_router import router as chunk_router

app = FastAPI(
    title="RAG Visualizer",
    description="An X-Ray machine for RAG pipelines",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chunk_router)
app.include_router(retrieval_router)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

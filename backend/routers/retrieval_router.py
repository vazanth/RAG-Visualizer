from backend.constants import hyde_prompt
from backend.engines import llm_client
from backend.engines.llm_client import OllamaClient
from backend.constants import system_instructions
import asyncio
from typing import Any, Optional
from fastapi import APIRouter
import json
import re
from backend.engines.embedding import EmbeddingEngine
from backend.engines.reducer import ReducerEngine
from backend.models.schemas import (
    CompareRequest,
    CompareResponse,
    QueryRequest,
    QueryResponse,
    RetrievedChunk,
)
from backend.storage.vector_store import VectorStore

from nltk.tokenize import RegexpTokenizer
from nltk.corpus import stopwords

router = APIRouter(prefix="/api", tags=["retrieval"])


tokenizer = RegexpTokenizer(r"\w+")
stop_words = set(stopwords.words("english"))


@router.post("/retrieve", response_model=QueryResponse)
async def retrieve(request: QueryRequest):

    if request.use_reranking == True:
        "" ""

    retrieved_chunks, embeddings = await process_retrieval(
        request.embedding_model,
        request.search_text,
        request.strategy,
        request.top_k,
        request.search_text,
    )

    query_coords = [0.0, 0.0]
    if ReducerEngine._last_fitted_reducer is not None:
        projected: Any = ReducerEngine._last_fitted_reducer.transform(embeddings)
        query_coords = projected[0].tolist()

    response_kwargs = {
        "query_text": request.search_text,
        "query_coords": query_coords,
        "results": retrieved_chunks,
    }

    if request.use_hyde:
        response_kwargs["hypothetical_answer"] = request.search_text

    return QueryResponse(**response_kwargs)


async def process_retrieval(
    model, search_text, strategy, top_k, original_query: Optional[str] = None
):
    vector_store = VectorStore()
    embedding_engine = EmbeddingEngine(model.value)
    embeddings = await embedding_engine.generate_embeddings([search_text])
    result: Any = await vector_store.retrieve(
        collection_name=f"{model.value}_{strategy.value}".replace(":", "-"),
        embeddings=embeddings,
        n_results=top_k,
    )

    retrieved_chunks = []

    highlight_text = original_query if original_query is not None else search_text

    # Check if result contains valid data
    if result and "ids" in result and result["ids"]:
        ids = result["ids"][0]
        documents = result["documents"][0]
        distances = result["distances"][0]
        metadatas = result["metadatas"][0]

        for i in range(len(ids)):

            meta = metadatas[i] or {}
            retrieved_chunks.append(
                RetrievedChunk(
                    id=ids[i],
                    text=documents[i],
                    score=distances[i],
                    start_char=meta.get("start_char", 0),
                    end_char=meta.get("end_char", 0),
                    parent_id=meta.get("parent_id") or None,
                    level=meta.get("level", 0),
                )
            )

    return retrieved_chunks, embeddings

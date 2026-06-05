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
    JudgeResponse,
    JudgeRequest,
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

    search_text = (
        await get_hyde_text(request.search_text)
        if request.use_hyde
        else request.search_text
    )

    if request.use_reranking == True:
        "" ""

    retrieved_chunks, embeddings = await process_retrieval(
        request.embedding_model,
        search_text,
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
        response_kwargs["hypothetical_answer"] = search_text

    return QueryResponse(**response_kwargs)


@router.post("/compare", response_model=CompareResponse)
async def compare(request: CompareRequest):
    retrieval_text = (
        await get_hyde_text(request.search_text)
        if request.use_hyde
        else request.search_text
    )
    (
        (retrieved_chunks_a, _),
        (retrieved_chunks_b, _),
    ) = await asyncio.gather(
        process_retrieval(
            request.model_a,
            retrieval_text,
            request.strategy_a,
            request.top_k,
            request.search_text,
        ),
        process_retrieval(
            request.model_b,
            retrieval_text,
            request.strategy_b,
            request.top_k,
            request.search_text,
        ),
    )

    response_kwargs = {
        "search_text": request.search_text,
        "results_a": retrieved_chunks_a,
        "results_b": retrieved_chunks_b,
    }
    if request.use_hyde:
        response_kwargs["hypothetical_answer"] = retrieval_text

    return CompareResponse(**response_kwargs)


@router.post("/judge", response_model=JudgeResponse)
async def judge(request: JudgeRequest):
    prompt = system_instructions.format(
        search_query=request.search_query,
        chunk_a=request.chunk_a,
        chunk_b=request.chunk_b,
    )

    llm_client = OllamaClient()
    result = await llm_client.generate(prompt=prompt)

    print(f"res:res: {result}")

    result_dict = json.loads(result)

    return JudgeResponse(**result_dict)


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
            text_highlighted = get_text_highlights(documents[i], highlight_text)
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
                    text_highlighted=text_highlighted,
                )
            )

    return retrieved_chunks, embeddings


def get_text_highlights(original_text, search_text):
    query_keywords = get_keywords(search_text)
    if not query_keywords:
        return original_text

    query_keywords.sort(key=len, reverse=True)

    safe_keywords = [f"{re.escape(w)}(?:'s)?" for w in query_keywords]

    pattern_string = r"\b(" + "|".join(safe_keywords) + r")\b"
    pattern = re.compile(pattern_string, re.IGNORECASE)

    return pattern.sub(r"<mark>\1</mark>", original_text)


def get_keywords(text: str):
    token = tokenizer.tokenize(text.lower())
    return [word for word in token if word not in stop_words]


async def get_hyde_text(search_text):
    llm_client = OllamaClient()
    hyde_prompt.format(search_text=search_text)
    return await llm_client.generate(hyde_prompt, response_format=None)

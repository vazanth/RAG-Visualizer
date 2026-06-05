from typing import List
from fastapi import APIRouter, responses
from pydantic import config

from backend.engines.chunking import ChunkingEngine
from backend.engines.embedding import EmbeddingEngine
from backend.engines.reducer import ReducerEngine
from backend.models.schemas import (
    ChunkNode,
    ChunkRequest,
    ChunkResponse,
    Strategy,
    StrategyResult,
)
from backend.storage.vector_store import VectorStore

# TODO: import your schemas and engine

router = APIRouter(prefix="/api", tags=["chunking"])


# TODO: GET /strategies endpoint
@router.get("/strategies", response_model=List[Strategy])
def get_strategies():
    return list(Strategy)


# TODO: POST /chunk endpoint
@router.post("/chunk", response_model=ChunkResponse)
async def create_chunk(request: ChunkRequest):
    chunk_engine = ChunkingEngine()
    embedding_engine = EmbeddingEngine(request.embedding_model.value)
    reducer_engine = ReducerEngine(request.n_neighbors, request.min_dist)
    vector_store = VectorStore()
    response = []
    all_chunks = []
    strategy_results_map = {}

    for run in request.runs:
        strategy = run.strategy
        config = run.config
        chunks: List[ChunkNode] = await chunk_engine.chunk(
            text=request.text,
            strategy=strategy,
            config=config,
            embedding_model=request.embedding_model.value,
        )
        strategy_results_map[strategy] = chunks
        all_chunks.extend(chunks)

    embeddings = await embedding_engine.generate_embeddings(all_chunks)

    ids = [c.id for c in all_chunks]
    documents = [c.text for c in all_chunks]

    chunk_metadatas = [
        {
            "start_char": c.start_char,
            "end_char": c.end_char,
            "token_count": c.token_count,
            "level": c.level,
            "parent_id": c.parent_id or "",
        }
        for c in all_chunks
    ]

    await vector_store.upsert(
        collection_name=f"{request.embedding_model.value}_{request.runs[0].strategy.value}".replace(":", "-"),
        ids=ids,
        documents=documents,
        embeddings=embeddings,
        metadatas=chunk_metadatas,
    )

    coords_2d = reducer_engine.reduce(embeddings)

    for chunk, coords in zip(all_chunks, coords_2d):
        chunk.coords_2d = coords

    for strategy, chunks in strategy_results_map.items():
        total_chunks = len(chunks)
        total_tokens = sum(node.token_count for node in chunks)
        avg_tokens = total_tokens / total_chunks if total_chunks > 0 else 0

        response.append(
            StrategyResult(
                strategy=strategy,
                chunks=chunks,
                total_chunks=total_chunks,
                total_tokens=total_tokens,
                avg_token_count=int(avg_tokens),
            )
        )

    return ChunkResponse(results=response)

from backend.engines.re_ranker_engine import RerankerEngine
from backend.engines.bm25_engine import BM25Engine
from backend.engines.llm_client import OllamaClient
from backend.constants import system_instructions
import asyncio
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
import json
from backend.engines.embedding import EmbeddingEngine
from backend.engines.reducer import ReducerEngine
from backend.models.schemas import (
    CompareRequest,
    CompareResponse,
    JudgeResponse,
    JudgeRequest,
    QueryRequest,
    QueryResponse,
    RetrievalMode,
    RetrievedChunk,
)
from backend.storage.vector_store import VectorStore
from backend.utils import get_hyde_text, get_keywords, get_text_highlights, rrf

router = APIRouter(prefix="/api", tags=["retrieval"])


@router.post("/retrieve", response_model=QueryResponse)
async def retrieve(request: QueryRequest):

    search_text = (
        await get_hyde_text(request.search_text)
        if request.use_hyde
        else request.search_text
    )

    limit = request.top_k * 4 if request.use_reranking else request.top_k

    retrieved_chunks, embeddings = await process_retrieval(
        request.embedding_model,
        search_text,
        request.strategy,
        limit,
        request.retrieval_mode,
        request.search_text,
        request.metadata,
    )

    if request.use_reranking == True:
        re_ranker = RerankerEngine()
        retrieved_chunks = re_ranker.rerank(
            query=request.search_text, chunks=retrieved_chunks, top_k=request.top_k
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
    limit = request.top_k * 4 if request.use_reranking else request.top_k
    (
        (retrieved_chunks_a, _),
        (retrieved_chunks_b, _),
    ) = await asyncio.gather(
        process_retrieval(
            request.model_a,
            retrieval_text,
            request.strategy_a,
            limit,
            request.retrieval_mode_a,
            request.search_text,
            request.metadata,
        ),
        process_retrieval(
            request.model_b,
            retrieval_text,
            request.strategy_b,
            limit,
            request.retrieval_mode_b,
            request.search_text,
            request.metadata,
        ),
    )

    if request.use_reranking == True:
        re_ranker = RerankerEngine()
        retrieved_chunks_a = re_ranker.rerank(
            query=request.search_text,
            chunks=retrieved_chunks_a,
            top_k=request.top_k,
        )
        retrieved_chunks_b = re_ranker.rerank(
            query=request.search_text,
            chunks=retrieved_chunks_b,
            top_k=request.top_k,
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

    result_dict = json.loads(result)

    return JudgeResponse(**result_dict)


async def process_retrieval(
    model,
    search_text,
    strategy,
    top_k,
    retrieval_mode,
    original_query: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
):
    vector_store = VectorStore()
    embedding_engine = EmbeddingEngine(model.value)
    embeddings = await embedding_engine.generate_embeddings([search_text])
    collection_name = f"{model.value}_{strategy.value}".replace(":", "-")
    result: Any = None
    if retrieval_mode == RetrievalMode.DENSE:
        result: Any = await vector_store.retrieve(
            collection_name=collection_name,
            embeddings=embeddings,
            n_results=top_k,
            where=metadata,
        )
    elif retrieval_mode == RetrievalMode.SPARSE:
        all_data = await vector_store.get_all_documents(collection_name=collection_name)
        docs = all_data.get("documents") or []
        doc_ids = all_data.get("ids") or []
        meta_datas: List[Any] = all_data.get("metadatas", []) or []

        if not docs:
            result = {
                "ids": [[]],
                "documents": [[]],
                "distances": [[]],
                "metadatas": [[]],
            }
        else:
            bm25 = BM25Engine(documents=docs, doc_ids=doc_ids, metadatas=meta_datas)
            sparse_results = bm25.search(query=search_text, top_k=top_k, where=metadata)
            result = {
                "ids": [[res["id"] for res in sparse_results]],
                "documents": [[res["text"] for res in sparse_results]],
                "distances": [[res["score"] for res in sparse_results]],
                "metadatas": [[res["metadata"] for res in sparse_results]],
            }
    elif retrieval_mode == RetrievalMode.HYBRID:
        dense_res = await vector_store.retrieve(
            collection_name=collection_name,
            embeddings=embeddings,
            n_results=top_k * 2,
            where=metadata,
        )
        dense_ids = (
            dense_res.get("ids", [[]])[0] if dense_res and "ids" in dense_res else []
        )
        all_data = await vector_store.get_all_documents(collection_name)
        docs = all_data.get("documents", []) or []
        ids = all_data.get("ids", []) or []
        metadatas: List[Any] = all_data.get("metadatas", []) or []

        if not docs:
            result = {
                "ids": [[]],
                "documents": [[]],
                "distances": [[]],
                "metadatas": [[]],
            }
        else:
            bm25 = BM25Engine(documents=docs, doc_ids=ids, metadatas=metadatas)
            sparse_results = bm25.search(search_text, top_k=top_k * 2, where=metadata)
            sparse_ids = [res["id"] for res in sparse_results]

            # 2. Build a lookup map of the document contents
            doc_lookup = {
                ids[i]: {"text": docs[i], "metadata": metadatas[i]}
                for i in range(len(ids))
            }

            # 3. Fuse rankings
            fused_ranks = rrf(dense_ids, sparse_ids, k=60)[:top_k]

            # 4. Standardize output
            result = {
                "ids": [[item[0] for item in fused_ranks]],
                "documents": [[doc_lookup[item[0]]["text"] for item in fused_ranks]],
                "distances": [[item[1] for item in fused_ranks]],  # RRF score
                "metadatas": [
                    [doc_lookup[item[0]]["metadata"] for item in fused_ranks]
                ],
            }
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

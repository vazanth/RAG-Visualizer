from typing import List
from flashrank import Ranker, RerankRequest
from backend.models.schemas import RetrievedChunk


class RerankerEngine:
    _ranker = None

    def __init__(self):
        if RerankerEngine._ranker is None:
            RerankerEngine._ranker = Ranker(model_name="ms-marco-MiniLM-L-12-v2")
        self.ranker = RerankerEngine._ranker

    def rerank(self, query: str, chunks: List[RetrievedChunk], top_k: int):
        formatted_list = []
        for idx, chunk in enumerate(chunks):
            chunk.original_score = chunk.score
            chunk.original_rank = idx + 1
            formatted_list.append(
                {
                    "id": chunk.id,
                    "text": chunk.text,
                    "score": chunk.score,
                }
            )

        request = RerankRequest(query=query, passages=formatted_list)
        results = self.ranker.rerank(request)
        chunk_map = {chunk.id: chunk for chunk in chunks}
        reranked_chunks = []

        for result in results[:top_k]:
            chunk = chunk_map[result["id"]]
            chunk.score = float(result["score"])
            reranked_chunks.append(chunk)

        return reranked_chunks

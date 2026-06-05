from typing import Sequence
import httpx

from backend.models.schemas import ChunkNode, EmbeddingModel


class EmbeddingEngine:
    def __init__(self, embedding_model):
        self.embedding_model = embedding_model
        self.client = httpx.AsyncClient(timeout=60)

    async def generate_embeddings(self, chunks: Sequence[ChunkNode | str]):
        texts = [c if isinstance(c, str) else c.text for c in chunks]
        res = await self.client.post(
            "http://localhost:11434/api/embed",
            json={
                "model": self.embedding_model,
                "input": texts,
            },
        )

        res_json = res.json()

        if "embeddings" not in res_json or not res_json["embeddings"]:
            raise ValueError(
                f"Ollama failed to generate embeddings for {self.embedding_model}. Response: {res_json}"
            )

        return res_json["embeddings"]

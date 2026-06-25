from typing import Sequence

# import httpx
import os
from backend.constants import MODEL_MAP
from backend.models.schemas import ChunkNode
from sentence_transformers import SentenceTransformer


_model_cache = {}


class EmbeddingEngine:
    def __init__(self, embedding_model):
        self.embedding_model = embedding_model
        # self.client = httpx.AsyncClient(timeout=60)
        hf_name = MODEL_MAP.get(embedding_model, embedding_model)

        if hf_name not in _model_cache:
            token = os.environ.get("HF_TOKEN")
            _model_cache[hf_name] = SentenceTransformer(
                hf_name,
                trust_remote_code=True,
                token=token
            )
        self.model = _model_cache[hf_name]

    async def generate_embeddings(self, chunks: Sequence[ChunkNode | str]):
        texts = [c if isinstance(c, str) else c.text for c in chunks]
        # commented for using sentence transformer.
        # res = await self.client.post(
        #     "http://localhost:11434/api/embed",
        #     json={
        #         "model": self.embedding_model,
        #         "input": texts,
        #     },
        # )

        # res_json = res.json()

        # if "embeddings" not in res_json or not res_json["embeddings"]:
        #     raise ValueError(
        #         f"Ollama failed to generate embeddings for {self.embedding_model}. Response: {res_json}"
        #     )

        # return res_json["embeddings"]
        # sentence-transformers is sync, but it's fast on CPU for small batches
        embeddings = self.model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()

from pathlib import Path
from chromadb import PersistentClient
import asyncio


class VectorStore:
    def __init__(self):
        base_dir = Path(__file__).resolve().parent.parent.parent
        store_path = base_dir / "store"
        self.client = PersistentClient(path=str(store_path))

    def get_collection(self, name: str):
        return self.client.get_or_create_collection(
            name=name, metadata={"hnsw:space": "cosine"}
        )

    async def upsert(self, collection_name, ids, documents, embeddings, metadatas=None):
        collection = self.get_collection(collection_name)

        await asyncio.to_thread(
            collection.upsert,
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )

    async def retrieve(self, collection_name, embeddings, n_results=3):
        collection = self.get_collection(collection_name)

        return await asyncio.to_thread(
            collection.query, query_embeddings=embeddings, n_results=n_results
        )

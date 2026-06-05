import asyncio
import requests
from chromadb import PersistentClient
from google import genai
from storage.vector_store import VectorStore


# ---------------------------
# Embedding (query only)
# ---------------------------
class EmbeddingService:

    def __init__(self, model, batch_size) -> None:
        self.model = model
        self.batch_size = batch_size

    async def embed(self, chunks):
        # chunk = get_chunks(CONTENT, "markdown")
        if self.model == "nomic-embed-text":
            semaphore = asyncio.Semaphore(10)

            async def embedNomic(c):
                async with semaphore:
                    res = await asyncio.to_thread(
                        requests.post,
                        "http://localhost:11434/api/embeddings",
                        json={"model": "nomic-embed-text", "prompt": c},
                    )

                    data = res.json()
                    emb = data["embedding"]

                    return emb[0] if isinstance(emb[0], list) else emb

            tasks = [embedNomic(c) for c in chunks]
            return await asyncio.gather(*tasks)

        elif self.model == "gemini-embedding-2":
            client = genai.Client(api_key="AIzaSyAn1CVoFNavdphVbjCNAUeWbH8UBw5ZbtQ")
            semaphore = asyncio.Semaphore(5)

            async def embed_google(c: str):
                async with semaphore:
                    # Use 'content' (singular) for a single string
                    response = await asyncio.to_thread(
                        client.models.embed_content,
                        model="gemini-embedding-2",
                        contents=c,
                    )

                    # Explicitly check for None to satisfy Pylance
                    if response.embeddings is None:
                        return []

                    # The SDK usually returns a list of one embedding for a single content
                    if (
                        isinstance(response.embeddings, list)
                        and len(response.embeddings) > 0
                    ):
                        return response.embeddings[0].values

                    # Fallback for older SDK versions where it's a single object
                    return getattr(response.embeddings, "values", [])

            tasks = [embed_google(c) for c in chunks]
            return await asyncio.gather(*tasks)

        else:
            semaphore = asyncio.Semaphore(10)

            async def embedGemma(c):
                async with semaphore:
                    res = await asyncio.to_thread(
                        requests.post,
                        "http://localhost:11434/api/embeddings",
                        json={"model": "EmbeddingGemma", "prompt": c},
                    )

                    data = res.json()
                    emb = data["embedding"]

                    return emb[0] if isinstance(emb[0], list) else emb

            tasks = [embedGemma(c) for c in chunks]
            return await asyncio.gather(*tasks)


# ---------------------------
# Query + Eval
# ---------------------------
async def evaluate(collection, query, es, k=3):
    q_emb = (await es.embed([query]))[0]

    res = collection.query(query_embeddings=[q_emb], n_results=k)

    return res["documents"][0]


def score(results, keywords):
    for i, doc in enumerate(results):
        if any(k.lower() in doc.lower() for k in keywords):
            return int(1 / (i + 1))
    return 0


# ---------------------------
# MAIN
# ---------------------------
async def main():
    vs = VectorStore("./chroma_db")

    # collections (already indexed)
    c_nomic = vs.get_collection("nomic_test")
    c_gc = vs.get_collection("google_cloud_test")
    c_gl = vs.get_collection("google_local_test")

    # query embedders
    es_nomic = EmbeddingService("nomic-embed-text", 16)
    es_gc = EmbeddingService("gemini-embedding-2", 32)
    es_gl = EmbeddingService("EmbeddingGemma", 32)

    queries = [
        {
            "query": "What middleware does ROS2 use for communication?",
            "keywords": ["DDS", "Data Distribution Service"],
        },
        {
            "query": "Who was the first Roman Emperor?",
            "keywords": ["Augustus", "Senate"],
        },
        {
            "query": "What happens during a metabolic shift on keto?",
            "keywords": ["ketosis", "burn fats"],
        },
        {
            "query": "How do robots see their surroundings?",
            "keywords": ["LiDAR", "SLAM", "depth cameras"],
        },
    ]

    scores = {"nomic": 0, "google_cloud": 0, "google_local": 0}

    results_for_file = []

    for q in queries:
        query = q["query"]
        keywords = q["keywords"]

        r1 = await evaluate(c_nomic, query, es_nomic)
        r2 = await evaluate(c_gc, query, es_gc)
        r3 = await evaluate(c_gl, query, es_gl)

        # store top result for comparison
        results_for_file.append(
            {
                "query": query,
                "nomic": r1[0],
                "google_cloud": r2[0],
                "google_local": r3[0],
            }
        )

        # scoring
        scores["nomic"] += score(r1, keywords)
        scores["google_cloud"] += score(r2, keywords)
        scores["google_local"] += score(r3, keywords)

    write_results_to_md(results_for_file)


def write_results_to_md(results, filename="eval_results.md"):
    with open(filename, "w", encoding="utf-8") as f:
        f.write("# Embedding Model Comparison\n\n")

        for item in results:
            f.write(f"## Query: {item['query']}\n\n")

            f.write("| Model | Result |\n")
            f.write("|------|--------|\n")

            # escape pipes for markdown tables
            def clean(text):
                return text.replace("|", "\\|").replace("\n", "<br>")

            f.write(f"| Nomic | {clean(item['nomic'][:500])} |\n")
            f.write(f"| Google Cloud | {clean(item['google_cloud'][:500])} |\n")
            f.write(f"| Google Local | {clean(item['google_local'][:500])} |\n")

            f.write("\n---\n\n")


if __name__ == "__main__":
    asyncio.run(main())

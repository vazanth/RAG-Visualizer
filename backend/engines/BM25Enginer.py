import math
from typing import Any, Dict, List

from backend.routers.retrieval_router import get_keywords


class BM25Engine:
    def __init__(
        self, documents: List[str], doc_ids: List[str], metadatas: List[Dict[str, Any]]
    ):
        self.doc_ids = doc_ids
        self.documents = documents
        self.metadatas = metadatas
        self.corpus_size = len(documents)
        self.k1 = 1.5
        self.b = 0.75

        self.tokenized_docs = [get_keywords(doc) for doc in documents]
        self.doc_length = [len(doc) for doc in self.tokenized_docs]
        self.avg_doc_len = sum(self.doc_length) / max(1, self.corpus_size)

        self.doc_tfs = []
        self.dfs = {}
        self.build_frequencies()

    def build_frequencies(self):
        for doc in self.tokenized_docs:
            tfs = {}
            for term in doc:
                tfs[term] = tfs.get(term, 0) + 1
            self.doc_tfs.append(tfs)
            for term in doc:
                self.dfs[term] = self.dfs.get(term, 0) + 1

    def idf(self, term):
        df = self.dfs.get(term, 0)
        return math.log(1 + (self.corpus_size - df + 0.5) / (df + 0.5))

    def score(self, query: str, doc_index: int) -> float:
        query_terms = get_keywords(query)

        total_score = 0.0
        doc_len = self.doc_length[doc_index]
        tfs = self.doc_tfs[doc_index]

        for term in query_terms:
            tf = tfs.get(term, 0)
            if tf > 0:
                term_idf = self.idf(term)

                # BM25 term weighting formula
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (
                    1 - self.b + self.b * (doc_len / self.avg_doc_len)
                )

                total_score += term_idf * (numerator / denominator)

        return total_score

    def search(self, query: str, top_k: int = 3) -> list:
        scores = []
        # Score all docs
        for idx in range(self.corpus_size):
            s = self.score(query, idx)
            scores.append((s, idx))

        # Sort descending by score
        scores.sort(key=lambda x: x[0], reverse=True)

        # Return documents with structured metadata
        results = []
        for score, idx in scores[:top_k]:
            results.append(
                {
                    "id": self.doc_ids[idx],
                    "text": self.documents[idx],
                    "metadata": self.metadatas[idx],
                    "score": score,
                }
            )
        return results

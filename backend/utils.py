import re
from typing import List
from backend.constants import hyde_prompt
from backend.engines.llm_client import OllamaClient
from nltk.tokenize import RegexpTokenizer
from nltk.corpus import stopwords

tokenizer = RegexpTokenizer(r"\w+")
stop_words = set(stopwords.words("english"))


def get_keywords(text: str):
    token = tokenizer.tokenize(text.lower())
    return [word for word in token if word not in stop_words]


async def get_hyde_text(search_text):
    llm_client = OllamaClient()
    formatted_prompt = hyde_prompt.format(search_text=search_text)
    return await llm_client.generate(formatted_prompt, response_format=None)


def rrf(dense_ranks: List[str], sparse_ranks: List[str], k: int = 60) -> List[tuple]:
    rrf_scores = {}

    for rank, doc_id in enumerate(dense_ranks):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    for rank, doc_id in enumerate(sparse_ranks):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    return sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)


def get_text_highlights(original_text, search_text):
    query_keywords = get_keywords(search_text)
    if not query_keywords:
        return original_text

    query_keywords.sort(key=len, reverse=True)

    safe_keywords = [f"{re.escape(w)}(?:'s)?" for w in query_keywords]

    pattern_string = r"\b(" + "|".join(safe_keywords) + r")\b"
    pattern = re.compile(pattern_string, re.IGNORECASE)

    return pattern.sub(r"<mark>\1</mark>", original_text)

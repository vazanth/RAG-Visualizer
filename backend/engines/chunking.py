import math
import tiktoken
from typing import List
from nltk.tokenize import sent_tokenize
import numpy as np

from backend.engines.embedding import EmbeddingEngine

from langchain_text_splitters import (
    RecursiveCharacterTextSplitter,
    NLTKTextSplitter,
    CharacterTextSplitter,
)

from backend.models.schemas import ChunkConfig, ChunkNode


def count_token(text: str, tokenizer) -> int:
    _encoder = tiktoken.get_encoding(tokenizer)
    return len(_encoder.encode(text))


def fixed_size_strategy(text, config: ChunkConfig) -> List[ChunkNode]:
    splitter = CharacterTextSplitter.from_tiktoken_encoder(
        encoding_name=config.tokenizer,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
    )
    result = splitter.split_text(text)
    result = construct_chunk_node(text, result, config.tokenizer)
    return result


def sentence_strategy(text, config: ChunkConfig) -> List[ChunkNode]:
    text_splitter = NLTKTextSplitter.from_tiktoken_encoder(
        encoding_name=config.tokenizer,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
    )
    result = text_splitter.split_text(text)
    result = construct_chunk_node(text, result, config.tokenizer)
    return result


def recursive_strategy(text, config: ChunkConfig) -> List[ChunkNode]:
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name=config.tokenizer,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
        separators=config.separators,
    )
    result = splitter.split_text(text)
    result = construct_chunk_node(text, result, config.tokenizer)
    return result


def parent_child_strategy(text, config) -> List[ChunkNode]:
    parent_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name=config.tokenizer,
        chunk_size=config.parent_chunk_size,
        chunk_overlap=config.parent_chunk_overlap,
        separators=config.separators,
    )
    parent_chunks = parent_splitter.split_text(text)
    result = construct_parent_child_nodes(text, parent_chunks, config)
    return result


def construct_chunk_node(text, chunks, tokenizer):
    nodes = []
    current_position = 0
    for i, chunk in enumerate(chunks):
        # 1. Try exact find first
        start = text.find(chunk, current_position)

        # 2. If exact find fails, try a clean stripped version
        if start == -1:
            clean_anchor = chunk.strip()[:40]
            if clean_anchor:
                start = text.find(clean_anchor, current_position)

        # 3. If it still fails, park it at current_position
        if start == -1:
            start = current_position

        end = start + len(chunk)
        node = ChunkNode(
            id=f"chunk_{i}",
            order=i,
            text=chunk,
            token_count=count_token(chunk, tokenizer),
            start_char=start,
            end_char=end,
        )
        nodes.append(node)

        # Safely advance position but allow overlaps
        current_position = max(current_position, start + 1)

    return nodes


def construct_parent_child_nodes(text, parent_chunks, config):
    all_nodes = []
    current_position = 0
    for parent_index, parent_chunk in enumerate(parent_chunks):
        parent_start = text.find(parent_chunk, current_position)
        parent_end = parent_start + len(parent_chunk)

        parent_id = f"parent_{parent_index}"

        parent_node = ChunkNode(
            id=parent_id,
            order=parent_index,
            text=parent_chunk,
            token_count=count_token(parent_chunk, config.tokenizer),
            start_char=parent_start,
            end_char=parent_end,
            level=0,
            child_ids=[],
        )
        all_nodes.append(parent_node)

        child_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            encoding_name=config.tokenizer,
            chunk_size=config.child_chunk_size,
            chunk_overlap=config.child_chunk_overlap,
            separators=config.separators,
        )
        child_chunks = child_splitter.split_text(parent_chunk)

        child_position = parent_start

        for child_index, child_chunk in enumerate(child_chunks):

            child_start = text.find(child_chunk, child_position)
            child_end = child_start + len(child_chunk)

            child_id = f"{parent_id}_child_{child_index}"

            child_node = ChunkNode(
                id=child_id,
                order=child_index,
                text=child_chunk,
                token_count=count_token(child_chunk, config.tokenizer),
                start_char=child_start,
                end_char=child_end,
                level=1,
                parent_id=parent_id,
            )

            parent_node.child_ids.append(child_id)

            all_nodes.append(child_node)

            child_position = child_start + 1

        current_position = parent_start + 1

    return all_nodes


def cosine_similarity(v1, v2):
    dot_product = sum(x * y for x, y in zip(v1, v2))
    norm_v1 = math.sqrt(sum(x * x for x in v1))
    norm_v2 = math.sqrt(sum(x * x for x in v2))
    if not norm_v1 or not norm_v2:
        return 0.0
    return dot_product / (norm_v1 * norm_v2)


async def semantic_strategy(text, config: ChunkConfig, embedding_model):
    sentences = sent_tokenize(text)
    embedding_engine = EmbeddingEngine(embedding_model)

    if not sentences:
        return []

    temp_nodes = [
        ChunkNode(
            id=f"temp_{i}", order=i, text=s, token_count=0, start_char=0, end_char=0
        )
        for i, s in enumerate(sentences)
    ]

    sentence_embeddings = await embedding_engine.generate_embeddings(temp_nodes)

    similarities = []

    for i in range(len(sentence_embeddings) - 1):
        sim = cosine_similarity(sentence_embeddings[i], sentence_embeddings[i + 1])
        similarities.append(sim)

    distances = [1 - s for s in similarities]

    if not distances:
        return construct_chunk_node(text, sentences, config.tokenizer)

    mean_distance = np.mean(distances)
    std_deviation = np.std(distances)

    z_score_multiplier = 2.5 - (config.semantic_threshold * 3.0)
    dynamic_threshold = mean_distance + (z_score_multiplier * std_deviation)

    chunks = []
    current_chunks = [sentences[0]]

    for i in range(len(distances)):
        current_dist = distances[i]

        if current_dist > dynamic_threshold:
            is_greater_than_prev = (i == 0) or (current_dist > distances[i - 1])
            is_greater_than_or_equal_next = (i == len(distances) - 1) or (
                current_dist >= distances[i + 1]
            )

            if is_greater_than_prev and is_greater_than_or_equal_next:
                chunks.append(" ".join(current_chunks))
                current_chunks = [sentences[i + 1]]
            else:
                current_chunks.append(sentences[i + 1])
        else:
            current_chunks.append(sentences[i + 1])

    if current_chunks:
        chunks.append(" ".join(current_chunks))

    return construct_chunk_node(text, chunks, config.tokenizer)


class ChunkingEngine:

    async def chunk(self, text, strategy, config, embedding_model) -> List[ChunkNode]:
        strategy_func = self.available_strategy(strategy)
        if not strategy_func:
            raise ValueError(f"Unknown strategy: {strategy}")

        if strategy == "semantic":
            return await strategy_func(text, config, embedding_model)

        return strategy_func(text, config)

    def available_strategy(self, strategy):
        STRATEGY = {
            "fixed_size": fixed_size_strategy,
            "sentence": sentence_strategy,
            "recursive": recursive_strategy,
            "parent_child": parent_child_strategy,
            "semantic": semantic_strategy,
        }
        return STRATEGY.get(strategy)

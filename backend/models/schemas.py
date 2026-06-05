from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


# --- Chunk-related schemas ---


class Strategy(str, Enum):
    FIXED_SIZE = "fixed_size"
    SENTENCE = "sentence"
    RECURSIVE = "recursive"
    PARENT_CHILD = "parent_child"
    SEMANTIC = "semantic"


class EmbeddingModel(str, Enum):
    NOMIC_EMBED_TEXT = "nomic-embed-text"
    EMBEDDING_GEMMA = "EmbeddingGemma"
    QWEN_EMBEDDING = "qwen3-embedding:0.6b"


class RetrievalMode(str, Enum):
    DENSE = "dense"
    SPARSE = "sparse"
    HYBRID = "hybrid"


class ChunkConfig(BaseModel):
    chunk_size: int = 500
    chunk_overlap: int = 20
    semantic_threshold: float = 0.5
    separators: Optional[List[str]] = None
    tokenizer: str = "cl100k_base"
    parent_chunk_size: Optional[int] = None
    parent_chunk_overlap: Optional[int] = None
    child_chunk_size: Optional[int] = None
    child_chunk_overlap: Optional[int] = None


class ChunkNode(BaseModel):
    id: str
    order: int
    text: str
    token_count: int
    start_char: int
    end_char: int
    level: int = 0
    parent_id: Optional[str] = None
    child_ids: List[str] = []
    metadata: Dict[str, Any] = {}
    embeddings: Optional[List[float]] = None
    coords_2d: Optional[List[float]] = None


class StrategyRun(BaseModel):
    strategy: Strategy
    config: ChunkConfig


class StrategyResult(BaseModel):
    strategy: Strategy
    chunks: List[ChunkNode]
    total_chunks: int
    avg_token_count: int
    total_tokens: int


class ChunkRequest(BaseModel):
    text: str
    runs: List[StrategyRun]
    embedding_model: EmbeddingModel = EmbeddingModel.NOMIC_EMBED_TEXT
    n_neighbors: int = 15
    min_dist: float = 0.1


class ChunkResponse(BaseModel):
    results: List[StrategyResult]


class QueryRequest(BaseModel):
    search_text: str
    embedding_model: EmbeddingModel
    strategy: Strategy
    top_k: int = 3
    retrieval_mode: RetrievalMode = RetrievalMode.DENSE
    use_hyde: bool = False
    use_reranking: bool = False


class RetrievedChunk(BaseModel):
    id: str
    text: str
    score: float
    start_char: int
    end_char: int
    parent_id: Optional[str] = None
    level: int = 0
    text_highlighted: Optional[str] = None


class QueryResponse(BaseModel):
    query_text: str
    query_coords: List[float] = [0.0, 0.0]
    results: List[RetrievedChunk]
    hypothetical_answer: Optional[str] = None


class CompareRequest(BaseModel):
    search_text: str
    top_k: int = 3
    model_a: EmbeddingModel
    strategy_a: Strategy
    model_b: EmbeddingModel
    strategy_b: Strategy

    retrieval_mode: RetrievalMode = RetrievalMode.DENSE
    use_hyde: bool = False
    use_reranking: bool = False


class CompareResponse(BaseModel):
    search_text: str
    results_a: List[RetrievedChunk]
    results_b: List[RetrievedChunk]
    hypothetical_answer: Optional[str] = None


class JudgeRequest(BaseModel):
    search_query: str
    chunk_a: str
    chunk_b: str


class ChunkScore(BaseModel):
    query_relevance: int = Field(ge=1, le=10)
    answer_completeness: int = Field(ge=1, le=10)
    factual_plausibility: int = Field(ge=1, le=10)
    clarity: int = Field(ge=1, le=10)
    overall: float

    @model_validator(mode="after")
    def check_overall(self) -> "ChunkScore":
        expected = round(
            (
                self.query_relevance
                + self.answer_completeness
                + self.factual_plausibility
                + self.clarity
            )
            / 4,
            2,
        )
        self.overall = expected
        return self


class JudgeResponse(BaseModel):
    winner: Literal["chunk_a", "chunk_b", "tie"]
    confidence: float = Field(ge=0, le=1)

    chunk_a_score: ChunkScore
    chunk_b_score: ChunkScore

    winner_reason: str
    chunk_a_strengths: List[str]
    chunk_b_strengths: List[str]
    chunk_a_weaknesses: List[str]
    chunk_b_weaknesses: List[str]
    deciding_dimension: str

    @model_validator(mode="after")
    def check_winner_consistency(self) -> "JudgeResponse":
        a = self.chunk_a_score.overall
        b = self.chunk_b_score.overall
        gap = abs(a - b)

        if gap <= 0.5:
            self.winner = "tie"
        elif a > b:
            self.winner = "chunk_a"
        else:
            self.winner = "chunk_b"
        return self

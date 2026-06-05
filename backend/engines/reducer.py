import numpy as np
from numpy.typing import NDArray
from typing import List
import umap


class ReducerEngine:
    _last_fitted_reducer = None

    def __init__(self, n_neighbors, min_dist):
        self.n_neighbors = n_neighbors
        self.min_dist = min_dist

    def reduce(self, embeddings: List[List[float]]) -> List[List[float]]:
        n_samples = len(embeddings)

        if n_samples == 0:
            return []

        if n_samples == 1:
            return [[0.0, 0.1]]

        if n_samples < 5:
            return [[0.0, i * 0.1] for i in range(n_samples)]

        data = np.array(embeddings)

        safe_n_neighbors = min(self.n_neighbors, n_samples - 1)
        safe_n_neighbors = max(2, safe_n_neighbors)

        reducer = umap.UMAP(
            n_neighbors=safe_n_neighbors,
            min_dist=self.min_dist,
            metric="cosine",
            random_state=42,
            n_components=2,
        )

        coords_2d: NDArray[np.float32] = np.asarray(reducer.fit_transform(data))

        ReducerEngine._last_fitted_reducer = reducer

        return coords_2d.tolist()

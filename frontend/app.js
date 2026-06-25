/**
 * RAG Visualizer — Chunking Lab
 * Frontend logic: API calls, chunk highlighting, and interactive inspection.
 */

// ============================================================
// State
// ============================================================
const state = {
  text: "",
  strategy: "fixed_size",
  config: {
    chunk_size: 500,
    chunk_overlap: 20,
    tokenizer: "cl100k_base",
    separators: null,
    parent_chunk_size: 1000,
    parent_chunk_overlap: 100,
    child_chunk_size: 200,
    child_chunk_overlap: 20,
    embedding_model: "nomic-embed-text",
    n_neighbors: 15,
    min_dist: 0.1,
    semantic_threshold: 0.5,
  },
  activeTab: "xray-tab",
  results: null, // StrategyResult from API
  activeChunkId: null, // Currently highlighted chunk
  isLoading: false,
};

// ============================================================
// DOM References
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  textInput: $("#text-input"),
  charCount: $("#char-count"),
  strategyGrid: $("#strategy-grid"),
  btnRun: $("#btn-run"),
  xrayEmpty: $("#xray-empty"),
  xrayText: $("#xray-text"),
  chunkList: $("#chunk-list"),
  statTotal: $("#stat-total"),
  statAvgTokens: $("#stat-avg-tokens"),
  statTotalTokens: $("#stat-total-tokens"),
  statStrategy: $("#stat-strategy"),
  standardConfig: $("#standard-config"),
  parentChildConfig: $("#parent-child-config"),
  semanticConfig: $("#semantic-config"),
  separatorsSection: $("#separators-section"),
  separatorTags: $("#separator-tags"),
  separatorInput: $("#separator-input"),

  // Vector & UMAP config elements
  embeddingModel: $("#embedding-model"),
  nNeighbors: $("#n-neighbors"),
  minDist: $("#min-dist"),
  nNeighborsValue: $("#n-neighbors-value"),
  minDistValue: $("#min-dist-value"),

  // Tab elements
  tabButtons: $$(".tab-btn"),
  tabContents: $$(".tab-content"),

  // Canvas elements
  vectorCanvas: $("#vector-canvas"),
  vectorTooltip: $("#vector-tooltip"),

  // Query Simulator elements
  queryInput: $("#query-input"),
  btnQuery: $("#btn-query"),
  queryRetrievalMode: $("#query-retrieval-mode"),
  queryResultsDrawer: $("#query-results-drawer"),
  queryResultsList: $("#query-results-list"),
  closeDrawer: $("#close-drawer"),
};

// ============================================================
// Slider & Selection Bindings
// ============================================================
const sliders = [
  { id: "chunk-size", stateKey: "chunk_size", valueId: "chunk-size-value" },
  { id: "overlap", stateKey: "chunk_overlap", valueId: "overlap-value" },
  {
    id: "parent-size",
    stateKey: "parent_chunk_size",
    valueId: "parent-size-value",
  },
  {
    id: "parent-overlap",
    stateKey: "parent_chunk_overlap",
    valueId: "parent-overlap-value",
  },
  {
    id: "child-size",
    stateKey: "child_chunk_size",
    valueId: "child-size-value",
  },
  {
    id: "child-overlap",
    stateKey: "child_chunk_overlap",
    valueId: "child-overlap-value",
  },
  { id: "n-neighbors", stateKey: "n_neighbors", valueId: "n-neighbors-value" },
  {
    id: "min-dist",
    stateKey: "min_dist",
    valueId: "min-dist-value",
    isFloat: true,
  },
  {
    id: "semantic-threshold",
    stateKey: "semantic_threshold",
    valueId: "semantic-threshold-value",
    isFloat: true,
  },
];

sliders.forEach(({ id, stateKey, valueId, isFloat }) => {
  const slider = $(`#${id}`);
  const badge = $(`#${valueId}`);
  if (!slider || !badge) return;

  slider.addEventListener("input", () => {
    const val = isFloat ? parseFloat(slider.value) : parseInt(slider.value, 10);
    state.config[stateKey] = val;
    badge.textContent = isFloat ? val.toFixed(2) : val;
  });
});

if (dom.embeddingModel) {
  dom.embeddingModel.addEventListener("change", () => {
    state.config.embedding_model = dom.embeddingModel.value;
  });
}

// ============================================================
// Interactive Tab Switching
// ============================================================
dom.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetTab = btn.dataset.tab;
    state.activeTab = targetTab;

    // Toggle active classes on buttons
    dom.tabButtons.forEach((b) => b.classList.toggle("active", b === btn));

    // Toggle active content panels
    dom.tabContents.forEach((content) => {
      const isTarget = content.id === targetTab;
      content.classList.toggle("active", isTarget);
      content.style.display = isTarget ? "flex" : "none";
    });

    // If switching to vector tab, let the canvas redraw itself
    if (
      targetTab === "vector-tab" &&
      typeof window.drawVectorSpace === "function"
    ) {
      window.drawVectorSpace();
    }
  });
});

// ============================================================
// Text Input
// ============================================================
dom.textInput.addEventListener("input", () => {
  state.text = dom.textInput.value;
  dom.charCount.textContent = `${state.text.length} chars`;
});

const btnUploadFile = document.getElementById("btn-upload-file");
const fileInput = document.getElementById("file-input");

if (btnUploadFile && fileInput) {
  btnUploadFile.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
      const text = event.target.result;
      dom.textInput.value = text;
      state.text = text;
      dom.charCount.textContent = `${text.length} chars`;
      fileInput.value = "";
    };
    reader.readAsText(file);
  });
}


// ============================================================
// Strategy Selector
// ============================================================
dom.strategyGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".strategy-card");
  if (!card) return;

  $$(".strategy-card").forEach((c) => c.classList.remove("active"));
  card.classList.add("active");
  card.querySelector('input[type="radio"]').checked = true;

  state.strategy = card.dataset.strategy;
  updateConfigVisibility();
});

function updateConfigVisibility() {
  const isParentChild = state.strategy === "parent_child";
  const isRecursive = state.strategy === "recursive";
  const isSemantic = state.strategy === "semantic";

  // Show/hide standard config (hide for parent_child and semantic)
  dom.standardConfig.style.display =
    isParentChild || isSemantic ? "none" : "block";

  // Show/hide parent-child config
  dom.parentChildConfig.classList.toggle("visible", isParentChild);

  // Show/hide semantic config
  if (dom.semanticConfig) {
    dom.semanticConfig.style.display = isSemantic ? "block" : "none";
  }

  // Show/hide separators (for recursive and parent_child)
  dom.separatorsSection.style.display =
    isRecursive || isParentChild ? "block" : "none";
}

// ============================================================
// Separator Tags
// ============================================================
function getSeparators() {
  const tags = dom.separatorTags.querySelectorAll(".separator-tag");
  if (tags.length === 0) return null;
  return Array.from(tags).map((tag) => {
    const raw = tag.dataset.sep;
    // Convert escaped sequences back to real characters
    return raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  });
}

// Remove separator tag
dom.separatorTags.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove")) {
    e.target.closest(".separator-tag").remove();
  }
});

// Add separator tag
dom.separatorInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && dom.separatorInput.value.trim()) {
    e.preventDefault();
    const val = dom.separatorInput.value;
    const displayVal = val
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/ /g, "⎵");
    const tag = document.createElement("span");
    tag.className = "separator-tag";
    tag.dataset.sep = val;
    tag.innerHTML = `<code>${escapeHtml(displayVal)}</code><span class="remove">&times;</span>`;
    dom.separatorTags.insertBefore(tag, dom.separatorInput);
    dom.separatorInput.value = "";
  }
});

// ============================================================
// API Call
// ============================================================
async function runChunking() {
  if (state.isLoading || !state.text.trim()) return;

  // Reset visualizer and search highlights
  state.results = [];
  state.activeChunkId = null;
  unhighlightChunk();
  dom.xrayText.classList.remove("search-active");

  state.isLoading = true;
  dom.btnRun.classList.add("loading");
  dom.btnRun.classList.remove("ready");
  dom.btnRun.disabled = true;

  // Build request payload
  const runConfig = { tokenizer: state.config.tokenizer };

  if (state.strategy === "parent_child") {
    runConfig.parent_chunk_size = state.config.parent_chunk_size;
    runConfig.parent_chunk_overlap = state.config.parent_chunk_overlap;
    runConfig.child_chunk_size = state.config.child_chunk_size;
    runConfig.child_chunk_overlap = state.config.child_chunk_overlap;
  } else if (state.strategy === "semantic") {
    runConfig.semantic_threshold = state.config.semantic_threshold;
  } else {
    runConfig.chunk_size = state.config.chunk_size;
    runConfig.chunk_overlap = state.config.chunk_overlap;
  }

  // Add separators if applicable
  const separators = getSeparators();
  if (
    separators &&
    (state.strategy === "recursive" || state.strategy === "parent_child")
  ) {
    runConfig.separators = separators;
  }

  const payload = {
    text: state.text,
    runs: [
      {
        strategy: state.strategy,
        config: runConfig,
      },
    ],
    embedding_model: state.config.embedding_model,
    n_neighbors: state.config.n_neighbors,
    min_dist: state.config.min_dist,
  };

  try {
    const res = await fetch("/api/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("API Error:", err);
      alert(`API Error: ${JSON.stringify(err.detail || err)}`);
      return;
    }

    const data = await res.json();
    state.results = data.results[0]; // Single strategy for now
    state.activeChunkId = null;

    renderResults();
  } catch (err) {
    console.error("Network error:", err);
    alert("Failed to connect to the API. Is the server running?");
  } finally {
    state.isLoading = false;
    dom.btnRun.classList.remove("loading");
    dom.btnRun.disabled = false;
    dom.btnRun.classList.add("ready");
  }
}

dom.btnRun.addEventListener("click", runChunking);

// ============================================================
// Rendering
// ============================================================
function renderResults() {
  if (!state.results) return;

  const { chunks, total_chunks, avg_token_count, total_tokens, strategy } =
    state.results;

  // Compute stats if backend returned 0s
  const computedTotal = total_chunks || chunks.length;
  const computedTotalTokens =
    total_tokens || chunks.reduce((sum, c) => sum + c.token_count, 0);
  const computedAvg =
    avg_token_count ||
    (computedTotal > 0 ? Math.round(computedTotalTokens / computedTotal) : 0);

  // Update stats
  dom.statTotal.textContent = computedTotal;
  dom.statAvgTokens.textContent = computedAvg;
  dom.statTotalTokens.textContent = computedTotalTokens;
  dom.statStrategy.textContent = strategy;

  // Render X-Ray viewer
  renderXrayText(chunks);

  // Render chunk list
  renderChunkList(chunks);

  // Initialize and draw Vector Space (Phase 2)
  if (typeof window.initVectorSpace === "function") {
    window.initVectorSpace(chunks);
  }
}

// ============================================================
// X-Ray Text Viewer — Highlight chunks in the original text
// ============================================================
function renderXrayText(chunks) {
  dom.xrayEmpty.style.display = "none";
  dom.xrayText.style.display = "block";

  const text = state.text;
  if (!text) return;

  // 1. Create an array of "markers" for every character in the text
  // Each marker will store which chunks "own" this character
  const markers = Array.from({ length: text.length }, () => []);

  chunks.forEach((chunk) => {
    for (let i = chunk.start_char; i < chunk.end_char; i++) {
      if (i >= 0 && i < markers.length) {
        markers[i].push(chunk.id);
      }
    }
  });

  // 2. Build the HTML by grouping characters with the same "owners"
  let html = "";
  let currentOwnersId = null;
  let currentBuffer = "";

  for (let i = 0; i <= text.length; i++) {
    const owners = markers[i] || [];
    const ownersId = owners.join(",");

    if (ownersId !== currentOwnersId) {
      if (currentBuffer) {
        if (!currentOwnersId) {
          html += escapeHtml(currentBuffer);
        } else {
          const ownerList = currentOwnersId.split(",");
          const isOverlap = ownerList.length > 1;
          const primaryOwner = ownerList[0];
          const colorIdx = (ownerList.length % 4) + 1;

          html +=
            `<span class="chunk-highlight${isOverlap ? " overlap-region" : ""}" ` +
            `data-chunk-id="${primaryOwner}" ` +
            `data-all-chunks="${currentOwnersId}" ` +
            `data-color="${colorIdx}">` +
            escapeHtml(currentBuffer) +
            `</span>`;
        }
      }
      currentOwnersId = ownersId;
      currentBuffer = "";
    }

    if (i < text.length) {
      currentBuffer += text[i];
    }
  }

  dom.xrayText.innerHTML = html;

  // Add hover/click listeners to highlights
  dom.xrayText.querySelectorAll(".chunk-highlight").forEach((el) => {
    el.addEventListener("mouseenter", () => highlightChunk(el.dataset.chunkId));
    el.addEventListener("mouseleave", () => unhighlightChunk());
    el.addEventListener("click", () => selectChunk(el.dataset.chunkId));
  });
}

// ============================================================
// Chunk List (Right Panel)
// ============================================================
function renderChunkList(chunks) {
  let html = "";
  let currentParentId = null;

  chunks.forEach((chunk, index) => {
    // Add parent label for parent-child strategy
    if (chunk.level === 0 && state.strategy === "parent_child") {
      html += `<div class="parent-child-label">📦 Parent</div>`;
      currentParentId = chunk.id;
    } else if (chunk.level === 1 && chunk.parent_id !== currentParentId) {
      currentParentId = chunk.parent_id;
    }

    const preview =
      chunk.text.length > 120 ? chunk.text.slice(0, 120) + "…" : chunk.text;

    html += `
      <div class="chunk-item" data-chunk-id="${chunk.id}" data-level="${chunk.level}" data-index="${index + 1}">
        <div class="chunk-item-header">
          <span class="chunk-item-id">${chunk.id}</span>
          <div class="chunk-item-badges">
            <span class="chunk-badge tokens">${chunk.token_count} tok</span>
            <span class="chunk-badge">${chunk.end_char - chunk.start_char} chars</span>
          </div>
        </div>
        <div class="chunk-item-text">${escapeHtml(preview)}</div>
        <div class="chunk-item-meta">
          <span>start: ${chunk.start_char}</span>
          <span>end: ${chunk.end_char}</span>
          ${chunk.parent_id ? `<span>parent: ${chunk.parent_id}</span>` : ""}
        </div>
      </div>
    `;
  });

  dom.chunkList.innerHTML = html;

  // Add click/hover listeners
  dom.chunkList.querySelectorAll(".chunk-item").forEach((el) => {
    el.addEventListener("mouseenter", () => highlightChunk(el.dataset.chunkId));
    el.addEventListener("mouseleave", () => unhighlightChunk());
    el.addEventListener("click", () => selectChunk(el.dataset.chunkId));
  });
}

// ============================================================
// Highlight / Selection Logic
// ============================================================
function highlightChunk(chunkId) {
  // Highlight in X-ray viewer
  dom.xrayText.querySelectorAll(".chunk-highlight").forEach((el) => {
    const ownerList = (el.dataset.allChunks || "").split(",");
    el.classList.toggle("active", ownerList.includes(chunkId));
  });

  // Highlight in chunk list
  dom.chunkList.querySelectorAll(".chunk-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.chunkId === chunkId);
  });
}

function unhighlightChunk() {
  if (state.activeChunkId) {
    // If a chunk is "selected" (clicked), keep it highlighted
    highlightChunk(state.activeChunkId);
    return;
  }

  dom.xrayText.querySelectorAll(".chunk-highlight.active").forEach((el) => {
    el.classList.remove("active");
  });
  dom.chunkList.querySelectorAll(".chunk-item.active").forEach((el) => {
    el.classList.remove("active");
  });
}

window.selectChunk = function selectChunk(chunkId) {
  // Toggle selection
  state.activeChunkId = state.activeChunkId === chunkId ? null : chunkId;
  if (state.activeChunkId) {
    highlightChunk(state.activeChunkId);

    // Scroll the chunk into view in the X-ray panel
    const xrayEl = dom.xrayText.querySelector(`[data-chunk-id="${chunkId}"]`);
    if (xrayEl) {
      xrayEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Scroll the chunk into view in the list
    const listEl = dom.chunkList.querySelector(`[data-chunk-id="${chunkId}"]`);
    if (listEl) {
      listEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else {
    unhighlightChunk();
  }
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getRankShiftBadgeHtml(originalRank, currentRank) {
  if (originalRank === undefined || originalRank === null) {
    return "";
  }
  const shift = originalRank - currentRank;
  if (shift > 0) {
    return `<span class="rank-shift-badge rank-shift-up">▲ +${shift}</span>`;
  } else if (shift < 0) {
    return `<span class="rank-shift-badge rank-shift-down">▼ ${shift}</span>`;
  } else {
    return `<span class="rank-shift-badge rank-shift-unchanged">• Unchanged</span>`;
  }
}

function formatScoreHtml(score, originalScore, retrievalMode, useReranking) {
  let label = "Score";
  let formattedScore = score.toFixed(3);
  
  if (useReranking) {
    label = "Rerank";
    formattedScore = `${(score * 100).toFixed(1)}%`;
  } else if (retrievalMode === "sparse") {
    label = "BM25";
    formattedScore = score.toFixed(2);
  } else if (retrievalMode === "hybrid") {
    label = "RRF";
    formattedScore = score.toFixed(4);
  } else {
    label = "Dist";
    formattedScore = score.toFixed(3);
  }

  let html = `<span class="score-badge-val">${label}: ${formattedScore}</span>`;
  
  if (useReranking && originalScore !== null && originalScore !== undefined) {
    let origLabel = retrievalMode === "sparse" ? "BM25" : (retrievalMode === "hybrid" ? "RRF" : "Dist");
    let origFormatted = originalScore.toFixed(3);
    html += `<span class="score-badge-original" title="Score before reranking"> (was ${origLabel}: ${origFormatted})</span>`;
  }
  
  return html;
}

document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + Enter to run
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    runChunking();
  }
});

updateConfigVisibility();

// Local visual state for canvas physics and scaling
const vectorState = {
  chunks: [], // Holds our active chunks
  zoom: 1.0, // Scroll scale
  pan: { x: 0, y: 0 }, // Drag offset
  hoveredChunk: null, // Chunk under mouse cursor
  selectedChunk: null, // Active clicked chunk
  isDragging: false, // Drag state flag
  dragStart: { x: 0, y: 0 },
  activeQuery: null, // Active search query or sonar probe click

  // High/low UMAP coordinates (for scaling math)
  bounds: {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  },
};

// Stubs for you to implement the magical vector space rendering:
window.initVectorSpace = function (chunks) {
  console.log("Initializing Vector Space with chunks:", chunks);
  vectorState.chunks = chunks;

  if (chunks.length > 0) {
    const xs = chunks.map((c) => (c.coords_2d ? c.coords_2d[0] : 0));
    const ys = chunks.map((c) => (c.coords_2d ? c.coords_2d[1] : 0));

    vectorState.bounds.minX = Math.min(...xs);
    vectorState.bounds.maxX = Math.max(...xs);
    vectorState.bounds.minY = Math.min(...ys);
    vectorState.bounds.maxY = Math.max(...ys);
  }
  const canvas = dom.vectorCanvas;
  if (!canvas) return;

  // Set logical dimensions matching the bounding box
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  // Center alignment resetting
  vectorState.pan = { x: 0, y: 0 };
  vectorState.zoom = 1.0;
  vectorState.hoveredChunk = null;
  vectorState.selectedChunk = null;
  vectorState.activeQuery = null;

  // Bind custom interactive event handlers
  if (!canvas.dataset.listenersAttached) {
    setupCanvasListeners(canvas);
    canvas.dataset.listenersAttached = "true";
  }

  // Active smooth render animation loop
  if (!window.animationLoopActive) {
    startAnimationLoop();
  }
};

window.animationLoopActive = false;
function startAnimationLoop() {
  window.animationLoopActive = true;
  function tick() {
    window.drawVectorSpace();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Maps UMAP coordinates [x, y] to Canvas pixel coordinates [x, y]
function mapToCanvas(umapX, umapY, width, height) {
  const padding = 50; // Keeps dots from clipping the canvas edges
  const { minX, maxX, minY, maxY } = vectorState.bounds;

  // Avoid division by zero if all coordinates are identical
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // 1. Normalize UMAP value to a percentage (0.0 to 1.0)
  const pctX = (umapX - minX) / rangeX;
  const pctY = (umapY - minY) / rangeY;

  // 2. Map percentage to canvas size (with padding)
  const canvasX = padding + pctX * (width - padding * 2);
  const canvasY = padding + pctY * (height - padding * 2);

  return { x: canvasX, y: canvasY };
}

window.drawVectorSpace = function () {
  const canvas = dom.vectorCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Self-healing resize guard (handles hidden container init and window resizing)
  const rect = canvas.parentNode.getBoundingClientRect();
  const targetWidth = Math.floor(rect.width * window.devicePixelRatio);
  const targetHeight = Math.floor(rect.height * window.devicePixelRatio);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  }

  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Apply Panning and Zooming transformations
  ctx.save();
  ctx.translate(vectorState.pan.x, vectorState.pan.y);
  ctx.scale(vectorState.zoom, vectorState.zoom);

  // A. DRAW GRID IN TRANSFORMED SPACE
  ctx.strokeStyle = "rgba(15, 23, 42, 0.05)";
  ctx.lineWidth = 1 / vectorState.zoom;
  const gridSize = 40;

  // Calculate bounding box in transformed space to draw grid infinite-scrolling
  const startX = -vectorState.pan.x / vectorState.zoom;
  const endX = (width - vectorState.pan.x) / vectorState.zoom;
  const startY = -vectorState.pan.y / vectorState.zoom;
  const endY = (height - vectorState.pan.y) / vectorState.zoom;

  for (
    let x = Math.floor(startX / gridSize) * gridSize;
    x < endX;
    x += gridSize
  ) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (
    let y = Math.floor(startY / gridSize) * gridSize;
    y < endY;
    y += gridSize
  ) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  // B. DRAW PARENT-CHILD CONNECTION LINES
  if (state.strategy === "parent_child") {
    vectorState.chunks.forEach((chunk) => {
      if (chunk.level === 1 && chunk.parent_id) {
        const parent = vectorState.chunks.find((c) => c.id === chunk.parent_id);
        if (parent && chunk.coords_2d && parent.coords_2d) {
          const cpos = mapToCanvas(
            chunk.coords_2d[0],
            chunk.coords_2d[1],
            width,
            height,
          );
          const ppos = mapToCanvas(
            parent.coords_2d[0],
            parent.coords_2d[1],
            width,
            height,
          );

          ctx.beginPath();
          ctx.strokeStyle = "rgba(245, 158, 11, 0.2)";
          ctx.lineWidth = 1.5 / vectorState.zoom;
          ctx.moveTo(ppos.x, ppos.y);
          ctx.lineTo(cpos.x, cpos.y);
          ctx.stroke();
        }
      }
    });
  } // C. DRAW ACTIVE RETRIEVAL LINES AND ANIMATIONS
  if (vectorState.activeQuery) {
    // Increment pulse radius for animation
    vectorState.activeQuery.pulseRadius += 0.8;
    if (vectorState.activeQuery.pulseRadius > 50) {
      vectorState.activeQuery.pulseRadius = 0;
    }

    const qpos = mapToCanvas(
      vectorState.activeQuery.x,
      vectorState.activeQuery.y,
      width,
      height,
    );

    if (
      vectorState.activeQuery.state === "fetching" ||
      vectorState.activeQuery.state === "loaded"
    ) {
      // Flowing lines or loaded lines to topK
      const topK = vectorState.activeQuery.topK || [];
      if (vectorState.activeQuery.state === "fetching") {
        vectorState.activeQuery.flowOffset =
          (vectorState.activeQuery.flowOffset || 0) - 2;
      }

      topK.forEach((item, index) => {
        if (item.chunk.coords_2d) {
          const cpos = mapToCanvas(
            item.chunk.coords_2d[0],
            item.chunk.coords_2d[1],
            width,
            height,
          );
          ctx.beginPath();
          ctx.strokeStyle = "rgba(245, 158, 11, 0.6)"; // Stronger gold
          ctx.lineWidth = 2 / vectorState.zoom;
          ctx.setLineDash([5, 5]);
          ctx.lineDashOffset =
            vectorState.activeQuery.state === "fetching"
              ? vectorState.activeQuery.flowOffset
              : 0;
          ctx.moveTo(qpos.x, qpos.y);
          ctx.lineTo(cpos.x, cpos.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }
  }
  // D. DRAW CHUNK PARTICLES
  vectorState.chunks.forEach((chunk) => {
    if (!chunk.coords_2d) return;

    const cpos = mapToCanvas(
      chunk.coords_2d[0],
      chunk.coords_2d[1],
      width,
      height,
    );

    // Style according to strategy and highlights
    let radius = 6;
    let color = "#2563eb"; // Superman Blue default
    let glowColor = "rgba(37, 99, 235, 0.15)";

    const isHovered =
      vectorState.hoveredChunk && vectorState.hoveredChunk.id === chunk.id;
    const isSelected = state.activeChunkId === chunk.id;

    if (state.strategy === "parent_child") {
      if (chunk.level === 0) {
        radius = 8;
        color = "#f59e0b"; // Superman Gold Parent
        glowColor = "rgba(245, 158, 11, 0.2)";
      } else {
        radius = 4.5;
        color = "#2563eb"; // Superman Blue Child
        glowColor = "rgba(37, 99, 235, 0.15)";
      }
    } else {
      // Standard styles
      radius = 5.5;
      color = "#2563eb";
      glowColor = "rgba(37, 99, 235, 0.15)";
    }

    // Dynamic scale-up on hover or selection (glowing Superman Red)
    if (isHovered || isSelected) {
      radius += 3;
      color = "#ef4444"; // Superman Red
      glowColor = isSelected
        ? "rgba(239, 68, 68, 0.45)"
        : "rgba(239, 68, 68, 0.25)";
    }

    // 1. Draw glowing background shadow ring
    ctx.beginPath();
    ctx.arc(cpos.x, cpos.y, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();

    // 2. Draw solid particle
    ctx.beginPath();
    ctx.arc(cpos.x, cpos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff"; // Clean white border outline for Light Mode
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // 3. Draw highlighted white core on selection
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(cpos.x, cpos.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    // 4. Rank 1 Sun Glow if loaded
    if (
      vectorState.activeQuery &&
      vectorState.activeQuery.state === "loaded" &&
      vectorState.activeQuery.topK &&
      vectorState.activeQuery.topK.length > 0
    ) {
      if (chunk.id === vectorState.activeQuery.topK[0].chunk.id) {
        // Pulsing sun glow radius
        const sunRadius = 15 + Math.sin(Date.now() / 300) * 5;
        ctx.beginPath();
        ctx.arc(cpos.x, cpos.y, sunRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 158, 11, 0.3)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cpos.x, cpos.y, radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b"; // Solid gold core
        ctx.fill();
      }
    }
  });

  // E. DRAW ACTIVE QUERY & SONAR PING SHOCKWAVES
  if (vectorState.activeQuery) {
    const qpos = mapToCanvas(
      vectorState.activeQuery.x,
      vectorState.activeQuery.y,
      width,
      height,
    );

    // 1. Draw Sonar ripple pulse rings (Superman Red wave)
    ctx.beginPath();
    ctx.arc(
      qpos.x,
      qpos.y,
      vectorState.activeQuery.pulseRadius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(239, 68, 68, ${1 - vectorState.activeQuery.pulseRadius / 50})`;
    ctx.lineWidth = 1.5 / vectorState.zoom;
    ctx.stroke();

    // 2. Draw outer glowing ring (Superman Red base)
    ctx.beginPath();
    ctx.arc(qpos.x, qpos.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5 / vectorState.zoom;
    ctx.fill();
    ctx.stroke();

    // 3. Draw crosshair target center
    ctx.beginPath();
    ctx.arc(qpos.x, qpos.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();

    // 4. Draw a small floating text label for the query
    ctx.fillStyle = "#475569"; // Dark muted slate text for excellent light mode readability
    ctx.font = `${Math.max(8, 10 / vectorState.zoom)}px var(--font-sans)`;
    ctx.textAlign = "center";
    ctx.fillText(
      vectorState.activeQuery.label || "Sonar Query",
      qpos.x,
      qpos.y - 12,
    );
  }

  ctx.restore();
};

function setupCanvasListeners(canvas) {
  const getMousePos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  canvas.addEventListener("mousedown", (e) => {
    const pos = getMousePos(e);
    vectorState.isDragging = true;
    vectorState.dragStartPos = { x: pos.x, y: pos.y };
    vectorState.dragStart = {
      x: pos.x - vectorState.pan.x,
      y: pos.y - vectorState.pan.y,
    };
  });

  canvas.addEventListener("mousemove", (e) => {
    const pos = getMousePos(e);
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    if (vectorState.isDragging) {
      // Pan canvas
      vectorState.pan.x = pos.x - vectorState.dragStart.x;
      vectorState.pan.y = pos.y - vectorState.dragStart.y;
    } else {
      // Hover detection
      const tx = (pos.x - vectorState.pan.x) / vectorState.zoom;
      const ty = (pos.y - vectorState.pan.y) / vectorState.zoom;

      let found = null;
      let minDistance = Infinity;

      vectorState.chunks.forEach((chunk) => {
        if (!chunk.coords_2d) return;
        const cpos = mapToCanvas(
          chunk.coords_2d[0],
          chunk.coords_2d[1],
          width,
          height,
        );
        const dist = Math.hypot(cpos.x - tx, cpos.y - ty);

        if (dist < 12 && dist < minDistance) {
          minDistance = dist;
          found = chunk;
        }
      });

      if (found !== vectorState.hoveredChunk) {
        vectorState.hoveredChunk = found;
        if (found) {
          highlightChunk(found.id);
          showTooltip(found, pos.x, pos.y);
        } else {
          unhighlightChunk();
          hideTooltip();
        }
      }
    }
  });

  canvas.addEventListener("mouseup", () => {
    vectorState.isDragging = false;
  });

  canvas.addEventListener("mouseleave", () => {
    vectorState.isDragging = false;
    vectorState.hoveredChunk = null;
    unhighlightChunk();
    hideTooltip();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const pos = getMousePos(e);

      // Decreased sensitivity with a smooth exponential multiplier
      const zoomFactor = 1 - e.deltaY * 0.0006;
      const prevZoom = vectorState.zoom;

      // Smoothly clamp zoom scale between 0.15 and 8.0
      vectorState.zoom = Math.min(
        Math.max(vectorState.zoom * zoomFactor, 0.15),
        8.0,
      );

      // Zoom centering physics
      vectorState.pan.x =
        pos.x - (pos.x - vectorState.pan.x) * (vectorState.zoom / prevZoom);
      vectorState.pan.y =
        pos.y - (pos.y - vectorState.pan.y) * (vectorState.zoom / prevZoom);
    },
    { passive: false },
  );

  canvas.addEventListener("click", (e) => {
    const pos = getMousePos(e);
    if (vectorState.dragStartPos) {
      const dx = pos.x - vectorState.dragStartPos.x;
      const dy = pos.y - vectorState.dragStartPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 5) {
        return; // It was a drag, not a click!
      }
    }
    if (vectorState.isDragging) return;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    const tx = (pos.x - vectorState.pan.x) / vectorState.zoom;
    const ty = (pos.y - vectorState.pan.y) / vectorState.zoom;

    let clickedNode = null;
    let minDistance = Infinity;

    vectorState.chunks.forEach((chunk) => {
      if (!chunk.coords_2d) return;
      const cpos = mapToCanvas(
        chunk.coords_2d[0],
        chunk.coords_2d[1],
        width,
        height,
      );
      const dist = Math.hypot(cpos.x - tx, cpos.y - ty);
      if (dist < 12 && dist < minDistance) {
        minDistance = dist;
        clickedNode = chunk;
      }
    });

    if (clickedNode) {
      selectChunk(clickedNode.id);
    } else {
      // Probe click to trigger Sonar RAG retrieval!
      triggerSonarProbe(tx, ty);
    }
  });
}

function showTooltip(chunk, x, y) {
  const tooltip = dom.vectorTooltip;
  if (!tooltip) return;

  const snippet =
    chunk.text.length > 80 ? chunk.text.slice(0, 80) + "..." : chunk.text;
  const coordsStr = `[${chunk.coords_2d[0].toFixed(2)}, ${chunk.coords_2d[1].toFixed(2)}]`;

  tooltip.style.display = "block";
  tooltip.style.left = `${x + 15}px`;
  tooltip.style.top = `${y + 15}px`;
  tooltip.innerHTML = `
    <div class="vector-tooltip-title">
      <span>${chunk.id}</span>
      <span class="vector-tooltip-coords">${coordsStr}</span>
    </div>
    <div style="font-size: 0.65rem; color: var(--text-tertiary); margin-bottom: var(--space-xs);">
      ${chunk.token_count} tokens | ${chunk.text.length} chars
    </div>
    <div class="vector-tooltip-text">${escapeHtml(snippet)}</div>
  `;
}

function hideTooltip() {
  const tooltip = dom.vectorTooltip;
  if (tooltip) tooltip.style.display = "none";
}

function triggerSonarProbe(tx, ty) {
  const canvas = dom.vectorCanvas;
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;

  // Convert canvas position [tx, ty] back to UMAP [x, y] coordinates
  const padding = 50;
  const { minX, maxX, minY, maxY } = vectorState.bounds;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const pctX = (tx - padding) / (width - padding * 2);
  const pctY = (ty - padding) / (height - padding * 2);

  const umapX = minX + pctX * rangeX;
  const umapY = minY + pctY * rangeY;

  // Perform similarity distance in 2D space to prepare topK
  const scoredChunks = vectorState.chunks
    .map((chunk) => {
      if (!chunk.coords_2d) return { chunk, dist: Infinity };
      const dist = Math.hypot(
        chunk.coords_2d[0] - umapX,
        chunk.coords_2d[1] - umapY,
      );
      return { chunk, dist };
    })
    .sort((a, b) => a.dist - b.dist);

  const topK = scoredChunks.slice(0, 3);

  // Set active query crosshair
  vectorState.activeQuery = {
    x: umapX,
    y: umapY,
    tx: tx,
    ty: ty,
    pulseRadius: 0,
    label: "Sonar Probe",
    state: "loaded",
    topK: topK,
  };

  // Render RAG results drawer
  dom.queryResultsDrawer.style.display = "block";
  dom.queryResultsList.innerHTML = topK
    .map((item, index) => {
      const similarity = Math.max(0, 1 - item.dist / 1.5).toFixed(2); // Normalised distance
      const snippet =
        item.chunk.text.length > 100
          ? item.chunk.text.slice(0, 100) + "..."
          : item.chunk.text;
      const rankClass = index === 0 ? "rank-1" : "";
      return `
      <div class="retrieved-chunk-card ${rankClass}" onclick="selectChunk('${item.chunk.id}')">
        <div class="retrieved-chunk-meta">
          <span class="retrieved-chunk-rank">Rank ${index + 1} (${item.chunk.id})</span>
          <span class="retrieved-chunk-score">Match Score: ${similarity}</span>
        </div>
        <div class="retrieved-chunk-text">${escapeHtml(snippet)}</div>
      </div>
    `;
    })
    .join("");
}

async function runQuerySimulator() {
  const queryText = dom.queryInput.value.trim();
  if (!queryText || !state.results || vectorState.chunks.length === 0) return;

  dom.btnQuery.disabled = true;
  dom.btnQuery.textContent = "⚡ Search...";

  try {
    console.log("Running Query against ChromaDB:", queryText);

    // Reset camera view so the user can see the entire map
    vectorState.zoom = 1.0;
    vectorState.pan = { x: 0, y: 0 };

    // Setup active query skeleton state (fetching)
    // We start at [0,0] and will update the actual coordinates once the server responds
    vectorState.activeQuery = {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      pulseRadius: 0,
      label: `Query: "${queryText.substring(0, 15)}"`,
      state: "fetching",
      flowOffset: 0,
      topK: [],
    };

    dom.queryResultsDrawer.style.display = "block";
    dom.queryResultsList.innerHTML = `
      <div class="skeleton-loader"></div>
      <div class="skeleton-loader"></div>
      <div class="skeleton-loader"></div>
    `;

    const useHyde = document.getElementById("query-use-hyde") ? document.getElementById("query-use-hyde").checked : false;
    const useReranking = document.getElementById("query-use-reranking") ? document.getElementById("query-use-reranking").checked : false;
    const filterLevel = document.getElementById("query-filter-level") ? document.getElementById("query-filter-level").value : "all";
    let whereClause = null;
    if (filterLevel === "parent") {
      whereClause = { "level": 0 };
    } else if (filterLevel === "child") {
      whereClause = { "level": 1 };
    }

    // Make the actual API call to the backend
    const res = await fetch("/api/retrieve", {
      method: "POST", // Needs to be POST to send a JSON body!
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_text: queryText,
        embedding_model: state.config.embedding_model,
        strategy: state.strategy,
        top_k: 3,
        retrieval_mode: dom.queryRetrievalMode ? dom.queryRetrievalMode.value : "dense",
        use_hyde: useHyde,
        use_reranking: useReranking,
        metadata: whereClause,
      }),
    });

    if (!res.ok) {
      let errMsg = `HTTP error! status: ${res.status}`;
      try {
        const errData = await res.json();
        if (errData && errData.detail) {
          errMsg = errData.detail;
        }
      } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();


    // Parse the query coordinates returned by UMAP
    const targetX = data.query_coords[0];
    const targetY = data.query_coords[1];

    const canvas = dom.vectorCanvas;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    // Dynamically expand bounds to fit the query dot if it lands far away
    if (vectorState.chunks.length > 0) {
      vectorState.bounds.minX = Math.min(vectorState.bounds.minX, targetX);
      vectorState.bounds.maxX = Math.max(vectorState.bounds.maxX, targetX);
      vectorState.bounds.minY = Math.min(vectorState.bounds.minY, targetY);
      vectorState.bounds.maxY = Math.max(vectorState.bounds.maxY, targetY);
    }

    const screenPos = mapToCanvas(targetX, targetY, width, height);

    // Link the retrieved results back to the frontend chunks for drawing lines
    const topK = data.results.map((result) => {
      // Find the corresponding chunk in the frontend's loaded chunks
      const chunk = vectorState.chunks.find((c) => c.id === result.id) || {
        id: result.id,
        text: result.text,
        coords_2d: null, // Fallback if chunk somehow isn't loaded
      };
      return {
        chunk: chunk,
        dist: result.score,
        text_highlighted: result.text_highlighted,
        original_rank: result.original_rank,
        original_score: result.original_score,
      };
    });

    // Update the active query with the final data
    vectorState.activeQuery = {
      x: targetX,
      y: targetY,
      tx: screenPos.x,
      ty: screenPos.y,
      pulseRadius: 0,
      label: `Query: "${queryText.substring(0, 15)}"`,
      state: "loaded",
      flowOffset: 0,
      topK: topK,
    };

    // Render results in the drawer
    let htmlContent = "";
    if (data.hypothetical_answer) {
      htmlContent += `
        <div class="query-result-item" style="border-left-color: var(--superman-blue); background-color: var(--superman-blue-muted); margin-bottom: 12px; border-radius: 6px; padding: 10px;">
          <div class="query-result-header" style="margin-bottom: 4px;">
            <span class="rank-badge" style="color: var(--superman-blue); font-weight: bold;">🔮 Generated Hypothetical Answer (HyDE)</span>
          </div>
          <div class="query-result-text" style="font-style: italic; color: var(--text-primary); font-size: 0.85rem;">"${escapeHtml(data.hypothetical_answer)}"</div>
        </div>
      `;
    }

    htmlContent += topK
      .map((item, index) => {
        const retrievalMode = dom.queryRetrievalMode ? dom.queryRetrievalMode.value : "dense";
        return `
        <div class="query-result-item" style="border-left-color: ${index === 0 ? "var(--warning-color)" : "var(--info-color)"}">
          <div class="query-result-header">
            <span class="rank-badge" style="color: ${index === 0 ? "var(--warning-color)" : "var(--info-color)"}">
              Rank ${index + 1}
              ${getRankShiftBadgeHtml(item.original_rank, index + 1)}
            </span>
            <span class="dist-badge">
              ${formatScoreHtml(item.dist, item.original_score, retrievalMode, useReranking)}
            </span>
          </div>
          <div class="query-result-text">${item.text_highlighted || escapeHtml(item.chunk.text.substring(0, 100)) + "..."}</div>
          <div class="query-result-meta">
            <span>ID: ${item.chunk.id}</span>
          </div>
        </div>
      `;
      })
      .join("");

    dom.queryResultsList.innerHTML = htmlContent;

    // --- TASK 3.4: X-RAY DOCUMENT HIGHLIGHTING ---
    // 1. Activate the search mode on the X-Ray text to dim non-retrieved chunks
    dom.xrayText.classList.add("search-active");

    // 2. Clear any previous search rankings
    dom.xrayText.querySelectorAll(".chunk-highlight").forEach((el) => {
      el.classList.remove(
        "retrieved-rank-1",
        "retrieved-rank-2",
        "retrieved-rank-3",
      );
    });

    // 3. Highlight the new Top-K chunks in the Document Viewer
    topK.forEach((item, index) => {
      const rank = index + 1;
      const chunkId = item.chunk.id;
      const spans = dom.xrayText.querySelectorAll(`[data-all-chunks*="${chunkId}"]`);

      spans.forEach((span) => {
        span.classList.add(`retrieved-rank-${rank}`);
      });

      // If it's the #1 hit, scroll the Document Viewer straight to it!
      if (rank === 1 && spans.length > 0) {
        spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    // ----------------------------------------------
  } catch (err) {
    console.error("Query failed:", err);
    dom.queryResultsList.innerHTML = `<div style="color: #ef4444; padding: 1rem;">${escapeHtml(err.message)}</div>`;
  } finally {
    dom.btnQuery.disabled = false;
    dom.btnQuery.innerHTML = "🔍 Query";
  }
}

// Bind Query events
if (dom.btnQuery) {
  dom.btnQuery.addEventListener("click", runQuerySimulator);
}
if (dom.queryInput) {
  dom.queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      runQuerySimulator();
    }
  });
}
if (dom.closeDrawer) {
  dom.closeDrawer.addEventListener("click", () => {
    dom.queryResultsDrawer.style.display = "none";
  });
}

// Bind HyDE change warning toasts
const queryUseHyde = document.getElementById("query-use-hyde");
if (queryUseHyde) {
  queryUseHyde.addEventListener("change", (e) => {
    if (e.target.checked) {
      showToast("HyDE enabled! Query generation via LLM will take a bit longer (around 2-3 seconds).", "info");
    }
  });
}

const arenaUseHyde = document.getElementById("arena-use-hyde");
if (arenaUseHyde) {
  arenaUseHyde.addEventListener("change", (e) => {
    if (e.target.checked) {
      showToast("HyDE enabled! Comparison query generation via LLM will take a bit longer (around 2-3 seconds).", "info");
    }
  });
}


// ============================================================
// TASK 3.5: ARENA COMPARISON LOGIC
// ============================================================
const domArena = {
  modal: document.getElementById("arena-modal"),
  btnOpen: document.getElementById("btn-open-arena"),
  btnClose: document.getElementById("btn-close-arena"),
  btnFight: document.getElementById("btn-arena-fight"),
  queryInput: document.getElementById("arena-query-input"),
  modelA: document.getElementById("arena-model-a"),
  strategyA: document.getElementById("arena-strategy-a"),
  resultsA: document.getElementById("arena-results-a"),
  modelB: document.getElementById("arena-model-b"),
  strategyB: document.getElementById("arena-strategy-b"),
  resultsB: document.getElementById("arena-results-b"),
  retrievalModeA: document.getElementById("arena-retrieval-mode-a"),
  retrievalModeB: document.getElementById("arena-retrieval-mode-b"),
};

if (domArena.btnOpen) {
  domArena.btnOpen.addEventListener("click", () => {
    domArena.modal.style.display = "flex";
    if (dom.queryInput && dom.queryInput.value) {
      domArena.queryInput.value = dom.queryInput.value;
    }
  });
}

if (domArena.btnClose) {
  domArena.btnClose.addEventListener("click", () => {
    domArena.modal.style.display = "none";
  });
}

if (domArena.btnFight) {
  domArena.btnFight.addEventListener("click", async () => {
    const query = domArena.queryInput.value.trim();
    if (!query) return;

    domArena.btnFight.disabled = true;
    domArena.btnFight.textContent = "FIGHTING...";

    // Reset AI Referee if active
    if (typeof domReferee !== "undefined" && domReferee.panel) {
      domReferee.panel.style.display = "none";
      domReferee.verdictBox.style.display = "none";
      domReferee.loadingBox.style.display = "none";
      domReferee.triggerBox.style.display = "block";
    }

    const hydeContainer = document.getElementById("arena-hyde-container");
    if (hydeContainer) {
      hydeContainer.style.display = "none";
    }

    domArena.resultsA.innerHTML =
      '<div class="skeleton-loader"></div><div class="skeleton-loader"></div>';
    domArena.resultsB.innerHTML =
      '<div class="skeleton-loader"></div><div class="skeleton-loader"></div>';

    try {
      const useHyde = document.getElementById("arena-use-hyde") ? document.getElementById("arena-use-hyde").checked : false;
      const useReranking = document.getElementById("arena-use-reranking") ? document.getElementById("arena-use-reranking").checked : false;
      const filterLevel = document.getElementById("arena-filter-level") ? document.getElementById("arena-filter-level").value : "all";
      let whereClause = null;
      if (filterLevel === "parent") {
        whereClause = { "level": 0 };
      } else if (filterLevel === "child") {
        whereClause = { "level": 1 };
      }

      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_text: query,
          top_k: 3,
          model_a: domArena.modelA.value,
          strategy_a: domArena.strategyA.value,
          model_b: domArena.modelB.value,
          strategy_b: domArena.strategyB.value,
          retrieval_mode_a: domArena.retrievalModeA ? domArena.retrievalModeA.value : "dense",
          retrieval_mode_b: domArena.retrievalModeB ? domArena.retrievalModeB.value : "dense",
          use_hyde: useHyde,
          use_reranking: useReranking,
          metadata: whereClause,
        }),
      });

      if (!res.ok) {
        let errMsg = "Comparison failed. Check if server is running.";
        try {
          const errData = await res.json();
          if (errData && errData.detail) {
            errMsg = errData.detail;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await res.json();


      // Render HyDE box if present
      const hydeText = document.getElementById("arena-hyde-text");
      if (hydeContainer && hydeText) {
        if (data.hypothetical_answer) {
          hydeText.textContent = `"${data.hypothetical_answer}"`;
          hydeContainer.style.display = "block";
        } else {
          hydeContainer.style.display = "none";
        }
      }

      // Render Column A
      if (data.results_a.length === 0) {
        domArena.resultsA.innerHTML = `
          <div style="text-align: center; color: var(--text-tertiary); padding: var(--space-xl); font-size: 0.9rem;">
            ⚠️ No matching chunks found. Make sure this model/strategy combination has been chunked first!
          </div>`;
      } else {
        domArena.resultsA.innerHTML = data.results_a
          .map(
            (chunk, i) => `
          <div class="query-result-item" style="border-left-color: var(--warning-color)">
            <div class="query-result-header">
              <span class="rank-badge" style="color: var(--warning-color)">
                Rank ${i + 1}
                ${getRankShiftBadgeHtml(chunk.original_rank, i + 1)}
              </span>
              <span class="dist-badge">
                ${formatScoreHtml(chunk.score, chunk.original_score, domArena.retrievalModeA ? domArena.retrievalModeA.value : "dense", useReranking)}
              </span>
            </div>
            <div class="query-result-text">${chunk.text_highlighted || escapeHtml(chunk.text)}</div>
            <div class="query-result-meta">
              <span>ID: ${chunk.id}</span>
            </div>
          </div>
        `,
          )
          .join("");
      }

      // Render Column B
      if (data.results_b.length === 0) {
        domArena.resultsB.innerHTML = `
          <div style="text-align: center; color: var(--text-tertiary); padding: var(--space-xl); font-size: 0.9rem;">
            ⚠️ No matching chunks found. Make sure this model/strategy combination has been chunked first!
          </div>`;
      } else {
        domArena.resultsB.innerHTML = data.results_b
          .map(
            (chunk, i) => `
          <div class="query-result-item" style="border-left-color: var(--info-color)">
            <div class="query-result-header">
              <span class="rank-badge" style="color: var(--info-color)">
                Rank ${i + 1}
                ${getRankShiftBadgeHtml(chunk.original_rank, i + 1)}
              </span>
              <span class="dist-badge">
                ${formatScoreHtml(chunk.score, chunk.original_score, domArena.retrievalModeB ? domArena.retrievalModeB.value : "dense", useReranking)}
              </span>
            </div>
            <div class="query-result-text">${chunk.text_highlighted || escapeHtml(chunk.text)}</div>
            <div class="query-result-meta">
              <span>ID: ${chunk.id}</span>
            </div>
          </div>
        `,
          )
          .join("");
      }

      // Activate AI Referee if both sides retrieved chunks
      if (
        typeof domReferee !== "undefined" &&
        domReferee.panel &&
        data.results_a.length > 0 &&
        data.results_b.length > 0
      ) {
        domReferee.panel.style.display = "block";
        domReferee.btnCall.dataset.query = query;
        domReferee.btnCall.dataset.chunkA = data.results_a[0].text;
        domReferee.btnCall.dataset.chunkB = data.results_b[0].text;
      }
    } catch (err) {
      console.error(err);
      domArena.resultsA.innerHTML = `<div style="color: var(--superman-red); padding: 1rem;">Error: ${err.message}</div>`;
      domArena.resultsB.innerHTML = `<div style="color: var(--superman-red); padding: 1rem;">Error: ${err.message}</div>`;
    } finally {
      domArena.btnFight.disabled = false;
      domArena.btnFight.textContent = "🔥 FIGHT!";
    }
  });
}

// ============================================================
// TASK 5.1: AI REFEREE / LLM-AS-A-JUDGE LOGIC
// ============================================================
const domReferee = {
  panel: document.getElementById("arena-referee-panel"),
  triggerBox: document.getElementById("referee-trigger-box"),
  btnCall: document.getElementById("btn-call-referee"),
  loadingBox: document.getElementById("referee-loading-box"),
  statusText: document.getElementById("referee-status-text"),
  verdictBox: document.getElementById("referee-verdict-box"),
};

if (domReferee.btnCall) {
  domReferee.btnCall.addEventListener("click", async () => {
    const query = domReferee.btnCall.dataset.query;
    const chunkA = domReferee.btnCall.dataset.chunkA;
    const chunkB = domReferee.btnCall.dataset.chunkB;
    if (!query || !chunkA || !chunkB) return;

    // Capture user-selected model names for clean revealed scorecard display
    const labelA = domArena.modelA.options[domArena.modelA.selectedIndex].text;
    const labelB = domArena.modelB.options[domArena.modelB.selectedIndex].text;

    showToast("Summoning AI referee. Running Qwen2.5-0.5B-Instruct on CPU container — evaluation will take ~15-20 seconds.", "info");

    domReferee.triggerBox.style.display = "none";
    domReferee.loadingBox.style.display = "block";
    domReferee.verdictBox.style.display = "none";

    const statuses = [
      "⚖️ Summoning AI evaluation referee...",
      "🔍 Blinding model names and metadata...",
      "🧠 Auditing Corner A relevance and clarity...",
      "🧠 Auditing Corner B completeness and truthfulness...",
      "📊 Aggregating overall dimensional scores...",
      "✍️ Draft verdict and writing final card...",
    ];
    let statusIdx = 0;
    domReferee.statusText.textContent = statuses[0];
    const statusInterval = setInterval(() => {
      statusIdx = (statusIdx + 1) % statuses.length;
      domReferee.statusText.textContent = statuses[statusIdx];
    }, 1500);

    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_query: query,
          chunk_a: chunkA,
          chunk_b: chunkB,
        }),
      });

      if (!res.ok) {
        let errMsg = "Evaluation referee failed to respond.";
        try {
          const errData = await res.json();
          if (errData && errData.detail) {
            errMsg = errData.detail;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await res.json();

      clearInterval(statusInterval);

      renderRefereeScorecard(data, labelA, labelB);
    } catch (err) {
      clearInterval(statusInterval);
      console.error(err);
      domReferee.verdictBox.innerHTML = `
        <div style="color: var(--superman-red); text-align: center; padding: 1.5rem; border: 1px solid var(--superman-red-glow); border-radius: 6px; background-color: var(--superman-red-muted);">
          <strong>Referee Error:</strong> ${err.message}
        </div>
      `;
      domReferee.verdictBox.style.display = "block";
    } finally {
      domReferee.loadingBox.style.display = "none";
    }
  });
}

function renderRefereeScorecard(data, labelA, labelB) {
  const isA = data.winner === "chunk_a";
  const isB = data.winner === "chunk_b";
  const isTie = data.winner === "tie";

  let winnerColor = "var(--superman-yellow)";
  let winnerBanner = "⚖️ IT'S A TIE";
  if (isA) {
    winnerColor = "var(--superman-yellow)";
    winnerBanner = `🏆 ${labelA.toUpperCase()} WINS`;
  } else if (isB) {
    winnerColor = "var(--superman-blue)";
    winnerBanner = `🏆 ${labelB.toUpperCase()} WINS`;
  }

  // Dynamically replace blinded chunk labels with actual bolded model names
  const boldLabelA = `<strong>${labelA}</strong>`;
  const boldLabelB = `<strong>${labelB}</strong>`;

  let cleanedReason = data.winner_reason.trim();
  // Strip leading/trailing quote characters
  cleanedReason = cleanedReason
    .replace(/^["']/, "")
    .replace(/["']$/, "")
    .trim();
  // Collapse any newlines or multiple whitespace characters to a single space for single-line display
  cleanedReason = cleanedReason.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ");

  cleanedReason = cleanedReason
    .replace(/\b(Chunk A|chunk_a|chunk A)\b/g, boldLabelA)
    .replace(/\b(Chunk B|chunk_b|chunk B)\b/g, boldLabelB);

  const scoreCardHtml = `
    <div class="verdict-banner" style="background-color: ${winnerColor}-muted; border-color: ${winnerColor};">
      <div class="verdict-title" style="color: ${winnerColor}">${winnerBanner}</div>
      <div class="verdict-confidence">Confidence: ${(data.confidence * 100).toFixed(0)}%</div>
    </div>
    
    <div class="verdict-reason">
      <strong>Verdict Reason:</strong>
      <p>${cleanedReason}</p>
      <div class="deciding-factor">Deciding Factor: <code>${data.deciding_dimension}</code></div>
    </div>

    <!-- Comparative Table of dimensions -->
    <div class="referee-scores-table">
      <div class="scores-table-header">
        <span class="score-col-label">Criterion</span>
        <span class="score-col-val" style="font-size: 0.65rem; color: var(--superman-yellow);">${labelA}</span>
        <span class="score-col-bar">Comparison</span>
        <span class="score-col-val" style="font-size: 0.65rem; color: var(--superman-blue);">${labelB}</span>
      </div>
      
      ${renderScoreRow("Query Relevance", data.chunk_a_score.query_relevance, data.chunk_b_score.query_relevance)}
      ${renderScoreRow("Completeness", data.chunk_a_score.answer_completeness, data.chunk_b_score.answer_completeness)}
      ${renderScoreRow("Plausibility", data.chunk_a_score.factual_plausibility, data.chunk_b_score.factual_plausibility)}
      ${renderScoreRow("Clarity & Style", data.chunk_a_score.clarity, data.chunk_b_score.clarity)}
      
      <div class="scores-table-row overall-row">
        <span class="score-col-label"><strong>Overall Average</strong></span>
        <span class="score-col-val" style="color: var(--superman-yellow)"><strong>${data.chunk_a_score.overall.toFixed(2)}</strong></span>
        <span class="score-col-bar">
          <div class="overall-progress-bar">
            <div class="overall-val-a" style="width: ${data.chunk_a_score.overall * 10}%"></div>
            <div class="overall-val-b" style="width: ${data.chunk_b_score.overall * 10}%"></div>
          </div>
        </span>
        <span class="score-col-val" style="color: var(--superman-blue)"><strong>${data.chunk_b_score.overall.toFixed(2)}</strong></span>
      </div>
    </div>

    <!-- Strengths & Weaknesses Column -->
    <div class="verdict-details-grid">
      <div class="verdict-details-col">
        <h4>${labelA} Analysis</h4>
        <div class="verdict-list-title strength-list-title">🟢 Strengths</div>
        <ul>
          ${data.chunk_a_strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ul>
        <div class="verdict-list-title weakness-list-title">🔴 Weaknesses</div>
        <ul>
          ${data.chunk_a_weaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
        </ul>
      </div>
      
      <div class="verdict-details-col">
        <h4>${labelB} Analysis</h4>
        <div class="verdict-list-title strength-list-title">🟢 Strengths</div>
        <ul>
          ${data.chunk_b_strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ul>
        <div class="verdict-list-title weakness-list-title">🔴 Weaknesses</div>
        <ul>
          ${data.chunk_b_weaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;

  domReferee.verdictBox.innerHTML = scoreCardHtml;
  domReferee.verdictBox.style.display = "block";
}

function renderScoreRow(label, valA, valB) {
  const pctA = valA * 10;
  const pctB = valB * 10;

  return `
    <div class="scores-table-row">
      <span class="score-col-label">${label}</span>
      <span class="score-col-val">${valA}/10</span>
      <span class="score-col-bar">
        <div class="score-progress-bar">
          <div class="score-val-a" style="width: ${pctA}%"></div>
          <div class="score-val-b" style="width: ${pctB}%"></div>
        </div>
      </span>
      <span class="score-col-val">${valB}/10</span>
    </div>
  `;
}

// --- TOAST NOTIFICATIONS SYSTEM ---
function showToast(message, type = "info") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "ℹ️";
  if (type === "warning") icon = "⚠️";
  else if (type === "success") icon = "✅";
  else if (type === "error") icon = "❌";
  else if (type === "info") icon = "🔮"; // Default to crystal ball for HyDE/LLM notice

  toast.innerHTML = `
    <span>${icon}</span>
    <span style="flex: 1;">${message}</span>
  `;

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 300);
  }, 4000);
}


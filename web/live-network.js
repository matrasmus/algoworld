class LiveNetwork {
  constructor(n, width, height, seed) {
    this.n = n;
    this.width = width;
    this.height = height;
    const rng = new SeededRNG(seed);

    const kComm = CONFIG.NUM_COMMUNITIES;

    // Community assignment (fixed for lifetime)
    const sizes = this._communitySizes(rng, n, kComm, 20, 50);
    this.community = [];
    for (let ci = 0; ci < sizes.length; ci++)
      for (let j = 0; j < sizes[ci]; j++) this.community.push(ci);
    rng.shuffle(this.community);

    // Topic shuffle (fixed)
    const topicMap = Array.from({ length: kComm }, (_, i) => i);
    rng.shuffle(topicMap);
    this.topic = this.community.map(c => topicMap[c]);

    // Controversy scores (fixed)
    this.controversy = [];
    for (let i = 0; i < n; i++) {
      this.controversy.push(rng.betavariate(CONFIG.CONTROVERSY_BETA_A, CONFIG.CONTROVERSY_BETA_B));
    }

    // Generate edge pool with maximum connectivity (mu_max, no censorship)
    // Each edge gets thresholds determining when it's active
    this.edgePool = [];
    this._generateEdgePool(rng, sizes, kComm);

    // Compute controversy boost from bridge fraction in the full graph
    this._boostControversy(rng);

    // Node degrees at two extremes of beta (for visual interpolation)
    this.degreesLowBeta = new Float64Array(n);  // tau1_min = 2.1 (heavy hubs)
    this.degreesHighBeta = new Float64Array(n);  // tau1_max = 3.5 (uniform)
    this._precomputeDegreeProfiles(rng);

    // Active state
    this.activeAdj = [];
    for (let i = 0; i < n; i++) this.activeAdj.push([]);
    this.activeEdgeIndices = [];

    // Layout
    this.posX = new Float64Array(n);
    this.posY = new Float64Array(n);
    this._initPositions(rng);
    this.k = Math.sqrt(width * height / Math.max(1, n)) * 0.9;
    this.tMax = Math.min(width, height) / 16;
    this.tMin = 0.3;
    this.layoutIter = 0;
    this.layoutTotal = 600;

    // Current knob values (for change detection)
    this._lastAlpha = -1;
    this._lastDelta = -1;

    // Initial edge computation
    this.updateEdges(0, 0);
    // Pre-settle layout
    for (let i = 0; i < 200; i++) this.layoutStep();
    this._fitToCanvas();
  }

  _communitySizes(rng, n, k, smin, smax) {
    let sizes = [];
    for (let i = 0; i < k; i++) sizes.push(rng.randInt(smin, smax));
    const total = sizes.reduce((a, b) => a + b, 0);
    const sc = n / total;
    sizes = sizes.map(s => Math.max(5, Math.round(s * sc)));
    let diff = n - sizes.reduce((a, b) => a + b, 0);
    let i = 0;
    while (diff !== 0) {
      const idx = i % k;
      if (diff > 0) { sizes[idx]++; diff--; }
      else if (sizes[idx] > 5) { sizes[idx]--; diff++; }
      i++;
      if (i > 10000) break;
    }
    return sizes;
  }

  _generateEdgePool(rng, sizes, kComm) {
    const n = this.n;
    const community = this.community;
    const targetEdges = Math.floor(n * 9 / 2);

    // Build weighted pools
    const byComm = {};
    const globalPool = [];
    for (let i = 0; i < n; i++) {
      const c = community[i];
      if (!byComm[c]) byComm[c] = [];
      byComm[c].push(i);
      globalPool.push(i);
    }

    const edgeSet = new Set();
    const addEdge = (u, v, isCross) => {
      if (u === v) return false;
      const key = u < v ? u * n + v : v * n + u;
      if (edgeSet.has(key)) return false;
      edgeSet.add(key);
      this.edgePool.push({
        u, v, isCross,
        alphaRank: isCross ? rng.random() : -1,
        // deltaThreshold computed after controversy boost
      });
      return true;
    };

    // Within-community edges (~60% of total)
    const withinTarget = Math.floor(targetEdges * 0.6);
    let placed = 0, attempts = 0;
    while (placed < withinTarget && attempts < withinTarget * 20) {
      attempts++;
      const ci = rng.randInt(0, kComm - 1);
      const pool = byComm[ci];
      if (!pool || pool.length < 2) continue;
      if (addEdge(rng.choice(pool), rng.choice(pool), false)) placed++;
    }

    // Cross-community edges (~40% of total, maximum mixing)
    const crossTarget = targetEdges - withinTarget;
    placed = 0; attempts = 0;
    while (placed < crossTarget && attempts < crossTarget * 20) {
      attempts++;
      const u = rng.choice(globalPool);
      const v = rng.choice(globalPool);
      if (community[u] === community[v]) continue;
      if (addEdge(u, v, true)) placed++;
    }

    // Ensure connectivity
    for (let i = 0; i < n; i++) {
      let hasEdge = false;
      for (const e of this.edgePool) {
        if (e.u === i || e.v === i) { hasEdge = true; break; }
      }
      if (!hasEdge) {
        const pool = byComm[community[i]];
        for (let t = 0; t < 30; t++) {
          const j = rng.choice(pool);
          if (j !== i && addEdge(i, j, false)) break;
        }
      }
    }
  }

  _boostControversy(rng) {
    // Boost controversy for nodes with many cross-community edges
    const n = this.n;
    const crossCount = new Int32Array(n);
    const totalCount = new Int32Array(n);
    for (const e of this.edgePool) {
      totalCount[e.u]++;
      totalCount[e.v]++;
      if (e.isCross) {
        crossCount[e.u]++;
        crossCount[e.v]++;
      }
    }
    for (let i = 0; i < n; i++) {
      const bridgeFrac = totalCount[i] > 0 ? crossCount[i] / totalCount[i] : 0;
      this.controversy[i] = Math.min(1.0,
        this.controversy[i] + CONFIG.BRIDGE_CONTROVERSY_BOOST * bridgeFrac);
    }

    // Now assign delta thresholds to edges
    for (const e of this.edgePool) {
      if (e.isCross) {
        // Edge is censored when max controversy of endpoints > tau_cens
        e.controversyMax = Math.max(this.controversy[e.u], this.controversy[e.v]);
      } else {
        e.controversyMax = 0; // within-community edges never censored
      }
    }
  }

  _precomputeDegreeProfiles(rng) {
    // Simulate what degrees would look like at beta=0 vs beta=1
    // by drawing from power-law at each extreme
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.degreesLowBeta[i] = this._powerlawSample(rng, CONFIG.TAU1_MIN, 3, 40);
      this.degreesHighBeta[i] = this._powerlawSample(rng, CONFIG.TAU1_MAX, 3, 40);
    }
    // Normalize both to similar mean
    const meanLow = this.degreesLowBeta.reduce((a, b) => a + b) / n;
    const meanHigh = this.degreesHighBeta.reduce((a, b) => a + b) / n;
    const targetMean = 10;
    for (let i = 0; i < n; i++) {
      this.degreesLowBeta[i] = Math.max(2, this.degreesLowBeta[i] * targetMean / meanLow);
      this.degreesHighBeta[i] = Math.max(2, this.degreesHighBeta[i] * targetMean / meanHigh);
    }
  }

  _powerlawSample(rng, tau, kmin, kmax) {
    const u = rng.random();
    const lo = Math.pow(kmin, 1 - tau);
    const hi = Math.pow(kmax, 1 - tau);
    return Math.max(kmin, Math.min(kmax, Math.round(
      Math.pow(lo + u * (hi - lo), 1 / (1 - tau))
    )));
  }

  _initPositions(rng) {
    const cx = this.width * 0.5, cy = this.height * 0.5;
    const radius = Math.min(this.width, this.height) * 0.30;
    const numTopics = CONFIG.NUM_COMMUNITIES;
    for (let i = 0; i < this.n; i++) {
      const t = this.topic[i];
      const angle = 2 * Math.PI * t / numTopics + rng.random() * 0.3 - 0.15;
      this.posX[i] = cx + radius * Math.cos(angle) + rng.random() * 120 - 60;
      this.posY[i] = cy + radius * Math.sin(angle) + rng.random() * 120 - 60;
    }
  }

  // --- Continuous edge updates ---

  updateEdges(alpha, delta) {
    // Determine which edges are active based on current knob values
    const muRatio = CONFIG.MU_MIN / CONFIG.MU_MAX; // ~0.125
    const crossThreshold = 1.0 - alpha * (1.0 - muRatio);
    const tauCens = CONFIG.CENSOR_MAX - delta * (CONFIG.CENSOR_MAX - CONFIG.CENSOR_MIN);

    // Clear adjacency
    for (let i = 0; i < this.n; i++) this.activeAdj[i] = [];
    this.activeEdgeIndices = [];

    for (let ei = 0; ei < this.edgePool.length; ei++) {
      const e = this.edgePool[ei];

      if (e.isCross) {
        // Alpha filter: edge visible when its rank < threshold
        if (e.alphaRank >= crossThreshold) continue;
        // Delta filter: censorship
        if (e.controversyMax > tauCens) continue;
      }

      this.activeAdj[e.u].push(e.v);
      this.activeAdj[e.v].push(e.u);
      this.activeEdgeIndices.push(ei);
    }

    this._lastAlpha = alpha;
    this._lastDelta = delta;
  }

  // --- Layout (continuous FR) ---

  layoutStep() {
    const n = this.n;
    const k = this.k;
    const cutoff = k * 6;
    const k2 = k * k;
    const px = this.posX, py = this.posY;

    const prog = Math.min(1.0, this.layoutIter / this.layoutTotal);
    const temp = this.tMax * (1 - prog) + this.tMin * prog;
    this.layoutIter++;

    const dispX = new Float64Array(n);
    const dispY = new Float64Array(n);

    // Repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        if (d > cutoff) continue;
        const f = k2 / d;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        dispX[i] += fx; dispY[i] += fy;
        dispX[j] -= fx; dispY[j] -= fy;
      }
    }

    // Attraction along ACTIVE edges only
    for (const ei of this.activeEdgeIndices) {
      const e = this.edgePool[ei];
      const dx = px[e.v] - px[e.u];
      const dy = py[e.v] - py[e.u];
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
      const f = (d * d) / k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      dispX[e.u] += fx; dispY[e.u] += fy;
      dispX[e.v] -= fx; dispY[e.v] -= fy;
    }

    // Gravity
    const gcx = this.width * 0.5;
    const gcy = this.height * 0.5;
    for (let i = 0; i < n; i++) {
      dispX[i] += (gcx - px[i]) * 0.005;
      dispY[i] += (gcy - py[i]) * 0.005;
    }

    // Cap by temperature
    for (let i = 0; i < n; i++) {
      const dmag = Math.sqrt(dispX[i] * dispX[i] + dispY[i] * dispY[i]) + 1e-9;
      const cap = Math.min(dmag, temp) / dmag;
      px[i] += dispX[i] * cap;
      py[i] += dispY[i] * cap;
    }
  }

  _fitToCanvas() {
    const pad = 30;
    const px = this.posX, py = this.posY;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (px[i] < xmin) xmin = px[i];
      if (px[i] > xmax) xmax = px[i];
      if (py[i] < ymin) ymin = py[i];
      if (py[i] > ymax) ymax = py[i];
    }
    const xspan = xmax > xmin ? xmax - xmin : 1;
    const yspan = ymax > ymin ? ymax - ymin : 1;
    const tw = this.width - 2 * pad;
    const th = this.height - 2 * pad;
    const scale = Math.min(tw / xspan, th / yspan);
    for (let i = 0; i < this.n; i++) {
      px[i] = (px[i] - xmin) * scale + pad + (tw - xspan * scale) * 0.5;
      py[i] = (py[i] - ymin) * scale + pad + (th - yspan * scale) * 0.5;
    }
  }

  // --- Per-frame update ---

  update(alpha, beta, delta, dt) {
    // Update edges if alpha or delta changed
    const alphaChanged = Math.abs(alpha - this._lastAlpha) > 0.001;
    const deltaChanged = Math.abs(delta - this._lastDelta) > 0.001;
    if (alphaChanged || deltaChanged) {
      this.updateEdges(alpha, delta);
      // Reset layout temperature so it can re-settle
      this.layoutIter = Math.max(0, this.layoutIter - 80);
    }

    // Always run a few layout steps for smooth animation
    const steps = this.layoutIter < this.layoutTotal ? 3 : 1;
    for (let i = 0; i < steps; i++) {
      this.layoutStep();
    }
  }

  // --- Rendering data ---

  getNodeRadius(i, beta) {
    const degLow = this.degreesLowBeta[i];
    const degHigh = this.degreesHighBeta[i];
    const deg = degLow + (degHigh - degLow) * beta;
    return nodeRadius(deg, 30, 1.5, 12);
  }

  getActiveDegree(i) {
    return this.activeAdj[i].length;
  }
}

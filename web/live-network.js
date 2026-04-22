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

    // Per-node hub score: how "hub-like" is this node?
    // Drawn from power-law at tau1_min (most hub-heavy extreme)
    this.hubScore = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.hubScore[i] = this._powerlawSample(rng, CONFIG.TAU1_MIN, 3, 50);
    }
    // Normalize to [0, 1]
    const maxHub = Math.max(...this.hubScore);
    for (let i = 0; i < n; i++) {
      this.hubScore[i] /= maxHub;
    }

    // Generate edge pool with maximum connectivity
    this.edgePool = [];
    this._generateEdgePool(rng, sizes, kComm);

    // Compute controversy boost from bridge fraction
    this._boostControversy(rng);

    // Assign beta thresholds to edges based on hub scores
    this._assignBetaThresholds(rng);

    // Active state
    this.activeAdj = [];
    for (let i = 0; i < n; i++) this.activeAdj.push([]);
    this.activeEdgeIndices = [];

    // Layout
    this.posX = new Float64Array(n);
    this.posY = new Float64Array(n);
    this.velX = new Float64Array(n);
    this.velY = new Float64Array(n);
    this._initPositions(rng);
    this.k = Math.sqrt(width * height / Math.max(1, n)) * 0.9;

    // Current knob values (for change detection)
    this._lastAlpha = -1;
    this._lastBeta = -1;
    this._lastDelta = -1;

    // Initial edge computation and settle
    this.updateEdges(0, 0, 0);
    for (let i = 0; i < 250; i++) this.layoutStep(true);
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
        betaRank: 0,
        controversyMax: 0,
      });
      return true;
    };

    // Within-community edges (~60%)
    const withinTarget = Math.floor(targetEdges * 0.6);
    let placed = 0, attempts = 0;
    while (placed < withinTarget && attempts < withinTarget * 20) {
      attempts++;
      const ci = rng.randInt(0, kComm - 1);
      const pool = byComm[ci];
      if (!pool || pool.length < 2) continue;
      if (addEdge(rng.choice(pool), rng.choice(pool), false)) placed++;
    }

    // Cross-community edges (~40%)
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
    for (const e of this.edgePool) {
      if (e.isCross) {
        e.controversyMax = Math.max(this.controversy[e.u], this.controversy[e.v]);
      }
    }
  }

  _assignBetaThresholds(rng) {
    // Beta controls degree distribution: low beta = hubs dominate, high beta = equal
    // Each edge gets a betaRank based on how "hub-like" its endpoints are
    // At high beta, edges from hubs are pruned to equalize degrees
    for (const e of this.edgePool) {
      const hubMax = Math.max(this.hubScore[e.u], this.hubScore[e.v]);
      // Mix hub score with randomness so pruning isn't perfectly deterministic
      e.betaRank = hubMax * 0.7 + rng.random() * 0.3;
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

  updateEdges(alpha, beta, delta) {
    const muRatio = CONFIG.MU_MIN / CONFIG.MU_MAX;
    const crossThreshold = 1.0 - alpha * (1.0 - muRatio);
    const tauCens = CONFIG.CENSOR_MAX - delta * (CONFIG.CENSOR_MAX - CONFIG.CENSOR_MIN);
    // Beta: at beta=0, all edges survive. At beta=1, edges with high betaRank are pruned.
    // Threshold ramps from 1.0 (all pass) to ~0.35 (only low-hub edges pass)
    const betaThreshold = 1.0 - beta * 0.65;

    for (let i = 0; i < this.n; i++) this.activeAdj[i] = [];
    this.activeEdgeIndices = [];

    for (let ei = 0; ei < this.edgePool.length; ei++) {
      const e = this.edgePool[ei];

      // Beta filter: prune hub-heavy edges as beta increases
      if (e.betaRank >= betaThreshold) continue;

      if (e.isCross) {
        if (e.alphaRank >= crossThreshold) continue;
        if (e.controversyMax > tauCens) continue;
      }

      this.activeAdj[e.u].push(e.v);
      this.activeAdj[e.v].push(e.u);
      this.activeEdgeIndices.push(ei);
    }

    this._lastAlpha = alpha;
    this._lastBeta = beta;
    this._lastDelta = delta;
  }

  // --- Layout ---

  layoutStep(settling) {
    const n = this.n;
    const k = this.k;
    const cutoff = k * 6;
    const k2 = k * k;
    const px = this.posX, py = this.posY;
    const vx = this.velX, vy = this.velY;

    // Fixed low temperature for continuous mode (higher during initial settle)
    const temp = settling ? 3.0 : 1.2;
    const damping = settling ? 0.85 : 0.6;

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

    // Attraction along active edges
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

    // Gravity toward center
    const gcx = this.width * 0.5;
    const gcy = this.height * 0.5;
    for (let i = 0; i < n; i++) {
      dispX[i] += (gcx - px[i]) * 0.008;
      dispY[i] += (gcy - py[i]) * 0.008;
    }

    // Soft boundary forces — push nodes back into canvas
    const pad = 20;
    const bx0 = pad, bx1 = this.width - pad;
    const by0 = pad, by1 = this.height - pad;
    const boundaryForce = 2.0;
    for (let i = 0; i < n; i++) {
      if (px[i] < bx0) dispX[i] += (bx0 - px[i]) * boundaryForce;
      if (px[i] > bx1) dispX[i] += (bx1 - px[i]) * boundaryForce;
      if (py[i] < by0) dispY[i] += (by0 - py[i]) * boundaryForce;
      if (py[i] > by1) dispY[i] += (by1 - py[i]) * boundaryForce;
    }

    // Velocity-based update with damping (prevents vibration)
    for (let i = 0; i < n; i++) {
      const dmag = Math.sqrt(dispX[i] * dispX[i] + dispY[i] * dispY[i]) + 1e-9;
      const cap = Math.min(dmag, temp) / dmag;
      vx[i] = (vx[i] + dispX[i] * cap) * damping;
      vy[i] = (vy[i] + dispY[i] * cap) * damping;
      px[i] += vx[i];
      py[i] += vy[i];
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
    // Zero velocities after fit
    this.velX.fill(0);
    this.velY.fill(0);
  }

  // --- Per-frame update ---

  update(alpha, beta, delta, dt) {
    const alphaChanged = Math.abs(alpha - this._lastAlpha) > 0.001;
    const betaChanged = Math.abs(beta - this._lastBeta) > 0.001;
    const deltaChanged = Math.abs(delta - this._lastDelta) > 0.001;
    if (alphaChanged || betaChanged || deltaChanged) {
      this.updateEdges(alpha, beta, delta);
    }

    // Run layout steps — always active for smooth response
    for (let i = 0; i < 2; i++) {
      this.layoutStep(false);
    }
  }

  // --- Rendering data ---

  getNodeRadius(i, beta) {
    // Node radius based on actual active degree
    const deg = this.activeAdj[i].length;
    return nodeRadius(deg, 20, 1.5, 12);
  }

  getActiveDegree(i) {
    return this.activeAdj[i].length;
  }
}

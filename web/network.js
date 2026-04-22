const Network = {
  generate(alpha, beta, delta, seed) {
    const rng = new SeededRNG(seed);
    const C = CONFIG;

    const mu = C.MU_MAX - alpha * (C.MU_MAX - C.MU_MIN);
    const tau1 = C.TAU1_MIN + beta * (C.TAU1_MAX - C.TAU1_MIN);
    const tauCens = C.CENSOR_MAX - delta * (C.CENSOR_MAX - C.CENSOR_MIN);

    const n = C.N;
    const kComm = C.NUM_COMMUNITIES;

    const sizes = this._communitySizes(rng, n, kComm, C.MIN_COMMUNITY_SIZE, C.MAX_COMMUNITY_SIZE);
    const community = [];
    for (let ci = 0; ci < sizes.length; ci++) {
      for (let j = 0; j < sizes[ci]; j++) community.push(ci);
    }
    rng.shuffle(community);

    let desired = [];
    for (let i = 0; i < n; i++) {
      desired.push(this._powerlawSample(rng, tau1, C.MIN_DEGREE, C.MAX_DEGREE));
    }
    const meanD = desired.reduce((a, b) => a + b, 0) / n;
    const scale = C.AVG_DEGREE / meanD;
    desired = desired.map(d =>
      Math.max(C.MIN_DEGREE, Math.min(C.MAX_DEGREE, Math.round(d * scale)))
    );

    const targetEdges = Math.floor(n * C.AVG_DEGREE / 2);
    const crossTarget = Math.floor(targetEdges * mu);
    const withinTarget = targetEdges - crossTarget;

    const adj = [];
    for (let i = 0; i < n; i++) adj.push(new Set());

    const byComm = {};
    const globalPool = [];
    for (let i = 0; i < n; i++) {
      const c = community[i];
      if (!byComm[c]) byComm[c] = [];
      const reps = Math.max(1, desired[i]);
      for (let r = 0; r < reps; r++) {
        byComm[c].push(i);
        globalPool.push(i);
      }
    }

    function addEdge(u, v) {
      if (u === v || adj[u].has(v)) return false;
      adj[u].add(v); adj[v].add(u);
      return true;
    }

    // Within-community edges
    let placed = 0, attempts = 0;
    while (placed < withinTarget && attempts < withinTarget * 20) {
      attempts++;
      const ci = rng.choices(
        Array.from({ length: kComm }, (_, i) => i),
        sizes
      );
      const pool = byComm[ci];
      if (!pool || pool.length < 2) continue;
      const u = rng.choice(pool);
      const v = rng.choice(pool);
      if (addEdge(u, v)) placed++;
    }

    // Cross-community edges
    placed = 0; attempts = 0;
    while (placed < crossTarget && attempts < crossTarget * 20) {
      attempts++;
      const u = rng.choice(globalPool);
      const v = rng.choice(globalPool);
      if (community[u] === community[v]) continue;
      if (addEdge(u, v)) placed++;
    }

    // Ensure everyone has at least one edge
    for (let i = 0; i < n; i++) {
      if (adj[i].size === 0) {
        const pool = byComm[community[i]];
        for (let t = 0; t < 30; t++) {
          const j = rng.choice(pool);
          if (j !== i) { addEdge(i, j); break; }
        }
      }
    }

    // Controversy
    const controversy = [];
    for (let i = 0; i < n; i++) {
      const base = rng.betavariate(C.CONTROVERSY_BETA_A, C.CONTROVERSY_BETA_B);
      const d = adj[i].size;
      let cross = 0;
      for (const j of adj[i]) {
        if (community[j] !== community[i]) cross++;
      }
      const bridgeFrac = d ? cross / d : 0;
      controversy.push(Math.min(1.0, base + C.BRIDGE_CONTROVERSY_BOOST * bridgeFrac));
    }

    // Censorship pruning
    for (let i = 0; i < n; i++) {
      if (controversy[i] > tauCens) {
        const toDrop = [];
        for (const j of adj[i]) {
          if (community[j] !== community[i]) toDrop.push(j);
        }
        for (const j of toDrop) {
          adj[i].delete(j); adj[j].delete(i);
        }
      }
    }

    // Topic assignment: permute community ids
    const topicMap = Array.from({ length: kComm }, (_, i) => i);
    rng.shuffle(topicMap);
    const topic = community.map(c => topicMap[c]);

    // Convert adj sets to arrays for faster iteration during rendering
    const adjArr = adj.map(s => Array.from(s));

    return { n, community, topic, adj: adjArr, controversy, pos: [] };
  },

  _powerlawSample(rng, tau, kmin, kmax) {
    const u = rng.random();
    let k;
    if (tau === 1.0) {
      k = kmin * Math.pow(kmax / kmin, u);
    } else {
      const lo = Math.pow(kmin, 1 - tau);
      const hi = Math.pow(kmax, 1 - tau);
      k = Math.pow(lo + u * (hi - lo), 1 / (1 - tau));
    }
    return Math.max(kmin, Math.min(kmax, Math.round(k)));
  },

  _communitySizes(rng, n, k, smin, smax, tau2 = 1.5) {
    let sizes = [];
    for (let i = 0; i < k; i++) {
      sizes.push(this._powerlawSample(rng, tau2, smin, smax));
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    const sc = n / total;
    sizes = sizes.map(s => Math.max(Math.floor(smin / 2), Math.round(s * sc)));
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
  },
};

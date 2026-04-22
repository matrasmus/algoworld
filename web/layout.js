const Layout = {
  createState(graph, width, height, seed) {
    const rng = new SeededRNG(seed || 0);
    const n = graph.n;
    const cx = width * 0.5, cy = height * 0.5;
    const radius = Math.min(width, height) * 0.30;
    const numTopics = CONFIG.NUM_COMMUNITIES;

    // Initial positions: cluster by topic
    const posX = new Float64Array(n);
    const posY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = graph.topic[i];
      const angle = 2 * Math.PI * t / numTopics + rng.random() * 0.3 - 0.15;
      const bx = cx + radius * Math.cos(angle);
      const by = cy + radius * Math.sin(angle);
      posX[i] = bx + rng.random() * 120 - 60;
      posY[i] = by + rng.random() * 120 - 60;
    }

    // Build edge arrays
    const eu = [], ev = [];
    for (let u = 0; u < n; u++) {
      for (const v of graph.adj[u]) {
        if (v > u) { eu.push(u); ev.push(v); }
      }
    }

    const area = width * height;
    const k = Math.sqrt(area / Math.max(1, n)) * 0.9;
    const tMax = Math.min(width, height) / 16.0;
    const tMin = 0.3;

    return {
      posX, posY, n, width, height,
      eu: new Int32Array(eu), ev: new Int32Array(ev),
      k, tMax, tMin, iter: 0,
    };
  },

  step(st, itersTotal) {
    itersTotal = itersTotal || 220;
    const prog = Math.min(1.0, st.iter / itersTotal);
    const temp = st.tMax * (1 - prog) + st.tMin * prog;
    st.iter++;

    const n = st.n;
    const k = st.k;
    const cutoff = k * 6;
    const k2 = k * k;
    const px = st.posX, py = st.posY;

    // Repulsion + gravity combined
    const dispX = new Float64Array(n);
    const dispY = new Float64Array(n);

    // Repulsion: O(n^2) but with cutoff
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i] - px[j];
        let dy = py[i] - py[j];
        let d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        if (d > cutoff) continue;
        const f = k2 / d;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        dispX[i] += fx; dispY[i] += fy;
        dispX[j] -= fx; dispY[j] -= fy;
      }
    }

    // Attraction along edges
    const eu = st.eu, ev = st.ev;
    for (let e = 0; e < eu.length; e++) {
      const u = eu[e], v = ev[e];
      const dx = px[v] - px[u];
      const dy = py[v] - py[u];
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
      const f = (d * d) / k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      dispX[u] += fx; dispY[u] += fy;
      dispX[v] -= fx; dispY[v] -= fy;
    }

    // Gravity toward center
    const gcx = st.width * 0.5;
    const gcy = st.height * 0.5;
    for (let i = 0; i < n; i++) {
      dispX[i] += (gcx - px[i]) * 0.005;
      dispY[i] += (gcy - py[i]) * 0.005;
    }

    // Cap displacement by temperature
    for (let i = 0; i < n; i++) {
      const dmag = Math.sqrt(dispX[i] * dispX[i] + dispY[i] * dispY[i]) + 1e-9;
      const cap = Math.min(dmag, temp) / dmag;
      px[i] += dispX[i] * cap;
      py[i] += dispY[i] * cap;
    }
  },

  fitToCanvas(st) {
    const pad = 40;
    const px = st.posX, py = st.posY;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < st.n; i++) {
      if (px[i] < xmin) xmin = px[i];
      if (px[i] > xmax) xmax = px[i];
      if (py[i] < ymin) ymin = py[i];
      if (py[i] > ymax) ymax = py[i];
    }
    const xspan = xmax > xmin ? xmax - xmin : 1;
    const yspan = ymax > ymin ? ymax - ymin : 1;
    const tw = st.width - 2 * pad;
    const th = st.height - 2 * pad;
    const scale = Math.min(tw / xspan, th / yspan);
    for (let i = 0; i < st.n; i++) {
      px[i] = (px[i] - xmin) * scale + pad + (tw - xspan * scale) * 0.5;
      py[i] = (py[i] - ymin) * scale + pad + (th - yspan * scale) * 0.5;
    }
  },

  run(graph, width, height, iterations, seed) {
    iterations = iterations || 220;
    const st = this.createState(graph, width, height, seed);
    for (let i = 0; i < iterations; i++) {
      this.step(st, iterations);
    }
    this.fitToCanvas(st);
    graph.pos = [];
    for (let i = 0; i < st.n; i++) {
      graph.pos.push([st.posX[i], st.posY[i]]);
    }
    return graph.pos;
  },
};

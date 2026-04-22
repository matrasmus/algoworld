const Cascade = {
  relevance(postTopic, community) {
    if (community === postTopic) return CONFIG.RELEVANCE_TARGET;
    const a = AFFINITY[postTopic][community];
    if (a >= 1) return CONFIG.RELEVANCE_POSITIVE;
    if (a === 0) return CONFIG.RELEVANCE_NEUTRAL;
    return CONFIG.RELEVANCE_OPPOSED;
  },

  run(graph, seedNode, postTopic, rng, alpha, beta) {
    alpha = alpha || 0;
    beta = beta !== undefined ? beta : 0.5;

    const efCross = CONFIG.EDGE_FACTOR_CROSS * (1.0 - 0.7 * alpha);
    const pBase = CONFIG.P_BASE * (1.0 + 0.5 * (1.0 - beta));

    const activated = new Set([seedNode]);
    let frontier = [seedNode];
    const steps = [[seedNode]];

    while (frontier.length > 0) {
      const nextFront = [];
      for (const u of frontier) {
        const cu = graph.topic[u];
        for (const v of graph.adj[u]) {
          if (activated.has(v)) continue;
          const cv = graph.topic[v];
          const rel = this.relevance(postTopic, cv);
          const ef = cu === cv ? CONFIG.EDGE_FACTOR_SAME : efCross;
          const p = Math.min(1.0, pBase * rel * ef);
          if (rng.random() < p) {
            activated.add(v);
            nextFront.push(v);
          }
        }
      }
      if (nextFront.length > 0) steps.push(nextFront);
      frontier = nextFront;
    }
    return steps;
  },
};

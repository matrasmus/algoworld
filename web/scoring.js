const Scoring = {
  scorePost(graph, activated, postTopic, nTotal) {
    const reachCount = activated.size;
    const reachPct = 100.0 * reachCount / nTotal;

    let nOpposed = 0, nPositive = 0, nNeutral = 0;
    for (const v of activated) {
      const a = AFFINITY[postTopic][graph.topic[v]];
      if (a < 0) nOpposed++;
      else if (a === 0) nNeutral++;
      else nPositive++;
    }

    let satPct = 0;
    if (reachCount > 0) {
      const fracHappy = nPositive / reachCount;
      const fracAngry = nOpposed / reachCount;
      const fracMeh = nNeutral / reachCount;
      satPct = 100.0 * fracHappy - 160.0 * fracAngry - 45.0 * fracMeh;
      satPct = Math.max(0, Math.min(100, satPct));
    }

    const communities = new Set();
    for (const v of activated) communities.add(graph.topic[v]);

    return {
      reach: reachCount,
      reachPct,
      rawSatisfaction: nPositive - nOpposed,
      satisfactionPct: satPct,
      communitiesHit: communities.size,
    };
  },

  scorePostStable(graph, seedNode, postTopic, nTotal, rng, alpha, beta) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = new SeededRNG(rng.randInt(0, 1 << 30));
      const steps = Cascade.run(graph, seedNode, postTopic, r, alpha, beta);
      const activated = new Set();
      for (const step of steps) {
        for (const v of step) activated.add(v);
      }
      const result = this.scorePost(graph, activated, postTopic, nTotal);
      runs.push({ result, steps, activated });
    }
    runs.sort((a, b) => a.result.reach - b.result.reach);
    return runs[1]; // median by reach
  },

  feedbackText(result) {
    const r = result.reachPct, s = result.satisfactionPct;
    if (r < 3) return "It stayed in a tiny bubble — barely anyone saw it.";
    if (s < 25) return "You went viral — but a lot of people were annoyed.";
    if (s < 40 && r > 25) return "Broad reach, lukewarm reception.";
    if (s >= 70 && r >= 20) return "Perfect shot — the right people loved it.";
    if (s >= 70) return "Great targeting! The fans loved it.";
    if (s >= 40) return "Solid — well received by most who saw it.";
    return "Mixed — it landed in places that didn't quite vibe.";
  },
};

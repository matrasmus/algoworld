"""Simplified LFR-style network generation: SBM + power-law degrees + censorship pruning."""

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Tuple

import config as C


@dataclass
class Graph:
    n: int
    community: List[int] = field(default_factory=list)   # per-node community index
    topic: List[int] = field(default_factory=list)        # per-node topic id (same as community after shuffle)
    adj: List[set] = field(default_factory=list)          # adjacency sets
    controversy: List[float] = field(default_factory=list)
    pos: List[Tuple[float, float]] = field(default_factory=list)  # layout positions

    def degree(self, i): return len(self.adj[i])
    def edges(self):
        for u, nbrs in enumerate(self.adj):
            for v in nbrs:
                if v > u:
                    yield (u, v)


def _powerlaw_sample(rng: random.Random, tau: float, kmin: int, kmax: int) -> int:
    # Continuous truncated power-law, then round.
    u = rng.random()
    if tau == 1.0:
        k = kmin * (kmax / kmin) ** u
    else:
        lo = kmin ** (1 - tau)
        hi = kmax ** (1 - tau)
        k = (lo + u * (hi - lo)) ** (1 / (1 - tau))
    return max(kmin, min(kmax, int(round(k))))


def _community_sizes(rng: random.Random, n: int, k_comm: int,
                     smin: int, smax: int, tau2: float = 1.5) -> List[int]:
    # Draw sizes from power-law, normalize to exactly n.
    sizes = [_powerlaw_sample(rng, tau2, smin, smax) for _ in range(k_comm)]
    total = sum(sizes)
    scale = n / total
    sizes = [max(smin // 2, int(round(s * scale))) for s in sizes]
    diff = n - sum(sizes)
    # Adjust to make sum exactly n
    i = 0
    while diff != 0:
        idx = i % k_comm
        if diff > 0:
            sizes[idx] += 1; diff -= 1
        elif sizes[idx] > 5:
            sizes[idx] -= 1; diff += 1
        i += 1
        if i > 10000: break
    return sizes


def generate(alpha: float, beta: float, delta: float, seed: int = None) -> Graph:
    rng = random.Random(seed)

    mu = C.MU_MAX - alpha * (C.MU_MAX - C.MU_MIN)         # [0.05, 0.40]
    tau1 = C.TAU1_MIN + beta * (C.TAU1_MAX - C.TAU1_MIN)   # [2.1, 3.5]
    tau_cens = C.CENSOR_MAX - delta * (C.CENSOR_MAX - C.CENSOR_MIN)  # [0.2, 1.0]

    n = C.N
    k_comm = C.NUM_COMMUNITIES

    sizes = _community_sizes(rng, n, k_comm, C.MIN_COMMUNITY_SIZE, C.MAX_COMMUNITY_SIZE)
    community = []
    for ci, s in enumerate(sizes):
        community.extend([ci] * s)
    rng.shuffle(community)

    # Desired degrees
    desired = [_powerlaw_sample(rng, tau1, C.MIN_DEGREE, C.MAX_DEGREE) for _ in range(n)]
    # Scale so mean ~ AVG_DEGREE
    mean_d = sum(desired) / n
    scale = C.AVG_DEGREE / mean_d
    desired = [max(C.MIN_DEGREE, min(C.MAX_DEGREE, int(round(d * scale)))) for d in desired]

    # Target edges ~ n * k / 2
    target_edges = n * C.AVG_DEGREE // 2
    # Split: mu fraction cross-community, rest within
    cross_target = int(target_edges * mu)
    within_target = target_edges - cross_target

    adj = [set() for _ in range(n)]

    # Node pools for weighted sampling: repeat each node ~ desired[i] times.
    by_comm = defaultdict(list)
    global_pool = []
    for i, c in enumerate(community):
        reps = max(1, desired[i])
        by_comm[c].extend([i] * reps)
        global_pool.extend([i] * reps)

    def add_edge(u, v):
        if u == v or v in adj[u]:
            return False
        adj[u].add(v); adj[v].add(u)
        return True

    # Within-community edges
    placed = 0; attempts = 0
    while placed < within_target and attempts < within_target * 20:
        attempts += 1
        ci = rng.choices(range(k_comm), weights=sizes)[0]
        pool = by_comm[ci]
        if len(pool) < 2: continue
        u = rng.choice(pool); v = rng.choice(pool)
        if add_edge(u, v):
            placed += 1

    # Cross-community edges
    placed = 0; attempts = 0
    while placed < cross_target and attempts < cross_target * 20:
        attempts += 1
        u = rng.choice(global_pool); v = rng.choice(global_pool)
        if community[u] == community[v]: continue
        if add_edge(u, v):
            placed += 1

    # Ensure everyone has at least one edge (connect isolates to a same-community neighbor)
    for i in range(n):
        if not adj[i]:
            pool = by_comm[community[i]]
            for _ in range(30):
                j = rng.choice(pool)
                if j != i:
                    add_edge(i, j); break

    # Controversy: Beta(2,5) base, boosted for bridge-y nodes (approx via cross-community edge fraction)
    controversy = []
    for i in range(n):
        base = rng.betavariate(C.CONTROVERSY_BETA_A, C.CONTROVERSY_BETA_B)
        d = len(adj[i])
        cross = sum(1 for j in adj[i] if community[j] != community[i])
        bridge_frac = cross / d if d else 0
        c = base + C.BRIDGE_CONTROVERSY_BOOST * bridge_frac
        controversy.append(min(1.0, c))

    # Censorship pruning: for controversial nodes, drop cross-community edges
    for i in range(n):
        if controversy[i] > tau_cens:
            to_drop = [j for j in adj[i] if community[j] != community[i]]
            for j in to_drop:
                adj[i].discard(j); adj[j].discard(i)

    # Topic assignment: permute community ids -> topic ids
    topic_map = list(range(C.NUM_COMMUNITIES))
    rng.shuffle(topic_map)
    topic = [topic_map[c] for c in community]

    g = Graph(n=n, community=community, topic=topic, adj=adj, controversy=controversy)
    return g

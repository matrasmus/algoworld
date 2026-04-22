"""Independent Cascade simulation, returned as a list of timesteps for animation."""

import random
from typing import List

import config as C
from topics import AFFINITY


def relevance(post_topic: int, community: int) -> float:
    a = AFFINITY[post_topic][community]
    if community == post_topic: return C.RELEVANCE_TARGET
    if a >= 1:  return C.RELEVANCE_POSITIVE
    if a == 0:  return C.RELEVANCE_NEUTRAL
    return C.RELEVANCE_OPPOSED


def run(graph, seed_node: int, post_topic: int, rng: random.Random,
        alpha: float = 0.0, beta: float = 0.5) -> List[List[int]]:
    # Alpha: high = similar-stuff filtering, cross-community edges transmit less
    ef_cross = C.EDGE_FACTOR_CROSS * (1.0 - 0.7 * alpha)
    # Beta: low = superstars boost spread, high = equal/organic = slower
    p_base = C.P_BASE * (1.0 + 0.5 * (1.0 - beta))

    activated = {seed_node}
    frontier = [seed_node]
    steps: List[List[int]] = [[seed_node]]
    while frontier:
        next_front = []
        for u in frontier:
            cu = graph.topic[u]
            for v in graph.adj[u]:
                if v in activated: continue
                cv = graph.topic[v]
                rel = relevance(post_topic, cv)
                ef = C.EDGE_FACTOR_SAME if cu == cv else ef_cross
                p = min(1.0, p_base * rel * ef)
                if rng.random() < p:
                    activated.add(v)
                    next_front.append(v)
        if next_front:
            steps.append(next_front)
        frontier = next_front
    return steps

"""Reach, satisfaction, and combined post score."""

from topics import AFFINITY


def score_post(graph, activated, post_topic: int, n_total: int):
    reach_count = len(activated)
    reach_pct = 100.0 * reach_count / n_total

    # Two-component satisfaction: happy fraction vs angry fraction.
    # Instead of averaging affinity (which regresses to neutral for mixed audiences),
    # compute the fraction of opposed nodes — even a minority of angry users tanks
    # the platform's satisfaction (they leave bad reviews, write angry posts, churn).
    n_opposed = 0
    n_positive = 0
    n_neutral = 0
    for v in activated:
        a = AFFINITY[post_topic][graph.topic[v]]
        if a < 0:
            n_opposed += 1
        elif a == 0:
            n_neutral += 1
        else:
            n_positive += 1
    if reach_count == 0:
        sat_pct = 0.0
    else:
        frac_happy = n_positive / reach_count
        frac_angry = n_opposed / reach_count
        frac_meh = n_neutral / reach_count
        sat_pct = 100.0 * frac_happy - 160.0 * frac_angry - 45.0 * frac_meh
        sat_pct = max(0.0, min(100.0, sat_pct))

    communities_hit = len(set(graph.topic[v] for v in activated))

    return {
        "reach": reach_count,
        "reach_pct": reach_pct,
        "raw_satisfaction": n_positive - n_opposed,
        "satisfaction_pct": sat_pct,
        "communities_hit": communities_hit,
    }


def score_post_stable(graph, seed_node, post_topic, n_total, cascade_run_fn, rng,
                      alpha=0.0, beta=0.5):
    """Run the cascade 3 times and return the median result (by reach).
    The cascade_steps from the median run are returned for animation."""
    import random
    runs = []
    for _ in range(3):
        r = random.Random(rng.randint(0, 1 << 30))
        steps = cascade_run_fn(graph, seed_node, post_topic, r,
                               alpha=alpha, beta=beta)
        activated = set()
        for step in steps:
            activated.update(step)
        result = score_post(graph, activated, post_topic, n_total)
        runs.append((result, steps, activated))
    runs.sort(key=lambda t: t[0]["reach"])
    return runs[1]  # median by reach: (result, steps, activated)


def feedback_text(result):
    r = result["reach_pct"]; s = result["satisfaction_pct"]
    if r < 3:     return "It stayed in a tiny bubble — barely anyone saw it."
    if s < 25:    return "You went viral — but a lot of people were annoyed."
    if s < 40 and r > 25: return "Broad reach, lukewarm reception."
    if s >= 70 and r >= 20: return "Perfect shot — the right people loved it."
    if s >= 70:   return "Great targeting! The fans loved it."
    if s >= 40:   return "Solid — well received by most who saw it."
    return "Mixed — it landed in places that didn't quite vibe."

"""Headless batch simulation of AlgoWorld games.

Runs thousands of games across parameter space, outputs CSV + summary.
Uses multiprocessing for parallelism (up to 50 CPUs).

Usage:
    python analysis.py                  # default: 1000 games, all available CPUs (max 50)
    python analysis.py --games 5000     # more games
    python analysis.py --workers 8      # limit parallelism
"""

import argparse
import csv
import itertools
import math
import multiprocessing
import os
import random
import sys
import time

import config as C
import network
import cascade
import scoring
from posts import draw_posts
from topics import TOPICS, AFFINITY


SEED_STRATEGIES = ["random", "target_community", "smart_hub"]


def pick_seed_node(graph, post_topic, strategy, rng):
    """Pick a seed node based on strategy."""
    if strategy == "random":
        return rng.randint(0, graph.n - 1)

    target_nodes = [i for i in range(graph.n) if graph.topic[i] == post_topic]
    if not target_nodes:
        return rng.randint(0, graph.n - 1)

    if strategy == "target_community":
        return rng.choice(target_nodes)

    if strategy == "smart_hub":
        target_nodes.sort(key=lambda i: len(graph.adj[i]), reverse=True)
        top_k = max(1, len(target_nodes) // 5)
        return rng.choice(target_nodes[:top_k])

    return rng.randint(0, graph.n - 1)


def simulate_one(args):
    """Simulate a single game. Called by pool workers."""
    alpha, beta, delta, strategy, game_seed = args

    rng = random.Random(game_seed)
    graph = network.generate(alpha, beta, delta, seed=rng.randint(0, 1 << 30))
    post_list = draw_posts(rng)

    post_results = []
    for post in post_list:
        seed_node = pick_seed_node(graph, post["topic"], strategy, rng)
        result, steps, activated = scoring.score_post_stable(
            graph, seed_node, post["topic"], C.N, cascade.run, rng,
            alpha=alpha, beta=beta
        )
        post_results.append(result)

    avg_reach = sum(r["reach_pct"] for r in post_results) / len(post_results)
    avg_sat = sum(r["satisfaction_pct"] for r in post_results) / len(post_results)

    return {
        "alpha": alpha,
        "beta": beta,
        "delta": delta,
        "strategy": strategy,
        "avg_reach": round(avg_reach, 2),
        "avg_satisfaction": round(avg_sat, 2),
        "post1_reach": round(post_results[0]["reach_pct"], 2),
        "post1_sat": round(post_results[0]["satisfaction_pct"], 2),
        "post2_reach": round(post_results[1]["reach_pct"], 2),
        "post2_sat": round(post_results[1]["satisfaction_pct"], 2),
        "post3_reach": round(post_results[2]["reach_pct"], 2),
        "post3_sat": round(post_results[2]["satisfaction_pct"], 2),
        "communities_hit": round(sum(r["communities_hit"] for r in post_results) / len(post_results), 1),
    }


def build_job_list(n_games, strategies):
    """Build parameter sweep + random sampling job list."""
    jobs = []
    master_rng = random.Random(42)

    # Grid sweep: 6 values per knob × 3 strategies = 648 combos, repeat to fill
    grid_vals = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    grid_combos = list(itertools.product(grid_vals, grid_vals, grid_vals))
    n_grid_per_strategy = len(grid_combos)
    n_grid_total = n_grid_per_strategy * len(strategies)

    for strategy in strategies:
        for alpha, beta, delta in grid_combos:
            jobs.append((alpha, beta, delta, strategy, master_rng.randint(0, 1 << 30)))

    # Fill remaining with uniform random sampling
    n_random = max(0, n_games - n_grid_total)
    for _ in range(n_random):
        alpha = round(master_rng.random(), 3)
        beta = round(master_rng.random(), 3)
        delta = round(master_rng.random(), 3)
        strategy = master_rng.choice(strategies)
        jobs.append((alpha, beta, delta, strategy, master_rng.randint(0, 1 << 30)))

    return jobs[:n_games]


def print_summary(results):
    """Print analysis summary to stdout."""
    print("\n" + "=" * 70)
    print("ANALYSIS SUMMARY")
    print("=" * 70)
    print(f"Total games simulated: {len(results)}")

    for strategy in SEED_STRATEGIES:
        subset = [r for r in results if r["strategy"] == strategy]
        if not subset:
            continue
        reaches = [r["avg_reach"] for r in subset]
        sats = [r["avg_satisfaction"] for r in subset]

        print(f"\n--- Strategy: {strategy} ({len(subset)} games) ---")
        print(f"  Reach:        mean={sum(reaches)/len(reaches):5.1f}%  "
              f"min={min(reaches):5.1f}%  max={max(reaches):5.1f}%")
        print(f"  Satisfaction: mean={sum(sats)/len(sats):5.1f}%  "
              f"min={min(sats):5.1f}%  max={max(sats):5.1f}%")

    # Quadrant analysis (using avg_reach and avg_satisfaction)
    print("\n--- Quadrant Distribution (all strategies) ---")
    quadrants = {
        "Echo Paradise (high reach, high sat)": lambda r: r["avg_reach"] >= 30 and r["avg_satisfaction"] >= 60,
        "Rage Machine (high reach, low sat)":   lambda r: r["avg_reach"] >= 30 and r["avg_satisfaction"] < 60,
        "Cozy Bubble (low reach, high sat)":    lambda r: r["avg_reach"] < 30 and r["avg_satisfaction"] >= 60,
        "Dead Platform (low reach, low sat)":   lambda r: r["avg_reach"] < 30 and r["avg_satisfaction"] < 60,
    }
    for name, pred in quadrants.items():
        count = sum(1 for r in results if pred(r))
        pct = 100 * count / len(results)
        print(f"  {name}: {count:4d} ({pct:5.1f}%)")

    # Knob sensitivity: which knob has the most impact on reach/satisfaction?
    print("\n--- Knob Sensitivity (correlation with outcomes) ---")
    for knob in ["alpha", "beta", "delta"]:
        vals = [r[knob] for r in results]
        reaches = [r["avg_reach"] for r in results]
        sats = [r["avg_satisfaction"] for r in results]
        r_corr = _pearson(vals, reaches)
        s_corr = _pearson(vals, sats)
        print(f"  {knob:5s}:  reach r={r_corr:+.3f}   satisfaction r={s_corr:+.3f}")

    # Hotspots: parameter ranges that produce extreme outcomes
    print("\n--- Hotspots ---")
    top_reach = sorted(results, key=lambda r: r["avg_reach"], reverse=True)[:20]
    top_sat = sorted(results, key=lambda r: r["avg_satisfaction"], reverse=True)[:20]
    bot_reach = sorted(results, key=lambda r: r["avg_reach"])[:20]
    bot_sat = sorted(results, key=lambda r: r["avg_satisfaction"])[:20]

    def summarize_params(subset, label):
        alphas = [r["alpha"] for r in subset]
        betas = [r["beta"] for r in subset]
        deltas = [r["delta"] for r in subset]
        reaches = [r["avg_reach"] for r in subset]
        sats = [r["avg_satisfaction"] for r in subset]
        print(f"  {label}:")
        print(f"    alpha: {sum(alphas)/len(alphas):.2f} (range {min(alphas):.2f}-{max(alphas):.2f})")
        print(f"    beta:  {sum(betas)/len(betas):.2f} (range {min(betas):.2f}-{max(betas):.2f})")
        print(f"    delta: {sum(deltas)/len(deltas):.2f} (range {min(deltas):.2f}-{max(deltas):.2f})")
        print(f"    reach: {sum(reaches)/len(reaches):.1f}%  sat: {sum(sats)/len(sats):.1f}%")

    summarize_params(top_reach, "Top 20 by reach")
    summarize_params(top_sat, "Top 20 by satisfaction")
    summarize_params(bot_reach, "Bottom 20 by reach")
    summarize_params(bot_sat, "Bottom 20 by satisfaction")

    # Reachability analysis
    print("\n--- Reach Distribution ---")
    buckets = [(0, 5), (5, 10), (10, 20), (20, 40), (40, 60), (60, 100)]
    for lo, hi in buckets:
        count = sum(1 for r in results if lo <= r["avg_reach"] < hi)
        bar = "#" * (count * 40 // len(results))
        print(f"  {lo:3d}-{hi:3d}%: {count:4d} ({100*count/len(results):5.1f}%) {bar}")

    print("\n--- Satisfaction Distribution ---")
    buckets = [(0, 20), (20, 35), (35, 50), (50, 65), (65, 80), (80, 100)]
    for lo, hi in buckets:
        count = sum(1 for r in results if lo <= r["avg_satisfaction"] < hi)
        bar = "#" * (count * 40 // len(results))
        print(f"  {lo:3d}-{hi:3d}%: {count:4d} ({100*count/len(results):5.1f}%) {bar}")


def _pearson(x, y):
    n = len(x)
    if n < 2:
        return 0.0
    mx = sum(x) / n
    my = sum(y) / n
    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    dx = math.sqrt(sum((xi - mx) ** 2 for xi in x))
    dy = math.sqrt(sum((yi - my) ** 2 for yi in y))
    if dx * dy == 0:
        return 0.0
    return num / (dx * dy)


def main():
    parser = argparse.ArgumentParser(description="AlgoWorld batch analysis")
    parser.add_argument("--games", type=int, default=1000, help="Number of games to simulate")
    parser.add_argument("--workers", type=int, default=None, help="Max parallel workers (default: min(cpu_count, 50))")
    parser.add_argument("--output", type=str, default="analysis_results.csv", help="Output CSV file")
    args = parser.parse_args()

    n_cpus = min(multiprocessing.cpu_count(), 50)
    if args.workers:
        n_cpus = min(args.workers, 50)

    print(f"AlgoWorld Batch Analysis")
    print(f"  Games: {args.games}")
    print(f"  Workers: {n_cpus}")
    print(f"  Strategies: {SEED_STRATEGIES}")
    print(f"  Output: {args.output}")

    jobs = build_job_list(args.games, SEED_STRATEGIES)
    print(f"  Jobs built: {len(jobs)}")
    print(f"\nRunning simulations...")

    t0 = time.time()
    with multiprocessing.Pool(processes=n_cpus) as pool:
        results = []
        for i, result in enumerate(pool.imap_unordered(simulate_one, jobs, chunksize=8)):
            results.append(result)
            if (i + 1) % 100 == 0 or i + 1 == len(jobs):
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed
                eta = (len(jobs) - i - 1) / rate if rate > 0 else 0
                print(f"  {i+1:5d}/{len(jobs)} done  ({rate:.1f} games/s, ETA {eta:.0f}s)")

    elapsed = time.time() - t0
    print(f"\nCompleted {len(results)} games in {elapsed:.1f}s ({len(results)/elapsed:.1f} games/s)")

    # Write CSV
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), args.output)
    fieldnames = list(results[0].keys())
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)
    print(f"Results written to {out_path}")

    print_summary(results)


if __name__ == "__main__":
    main()

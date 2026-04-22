"""Fruchterman-Reingold force-directed layout with numpy.

Classical FR with area-normalized parameters:
    k            = sqrt(area / n)          ideal inter-node spacing
    repel(u, v)  = k^2 / d * direction     (all pairs, global)
    attract(e)   = d^2 / k * direction     (along edges only)
    temperature  = max-step cap, decays linearly

Community structure emerges from the dense within-community edges in the SBM
output, so no explicit centroid-gravity term is needed. Empirically this
produces the familiar blob-of-blobs / hub-and-satellite look without edge
pinning.
"""

import math
import random
from typing import List, Tuple

import numpy as np

import config as C


def initial_positions(n: int, topics: List[int], num_topics: int,
                      cx: float, cy: float, radius: float,
                      rng: random.Random) -> List[Tuple[float, float]]:
    pos = []
    for t in topics:
        angle = 2 * math.pi * t / num_topics + rng.uniform(-0.15, 0.15)
        bx = cx + radius * math.cos(angle)
        by = cy + radius * math.sin(angle)
        pos.append((bx + rng.uniform(-60, 60), by + rng.uniform(-60, 60)))
    return pos


class LayoutState:
    def __init__(self, graph, width, height, seed=0):
        rng = random.Random(seed)
        cx, cy = width * 0.5, height * 0.5
        radius = min(width, height) * 0.30
        p0 = initial_positions(graph.n, graph.topic, C.NUM_COMMUNITIES, cx, cy, radius, rng)
        self.pos = np.array(p0, dtype=np.float64)
        self.n = graph.n
        self.width = width
        self.height = height
        us, vs = [], []
        for u, nbrs in enumerate(graph.adj):
            for v in nbrs:
                if v > u:
                    us.append(u); vs.append(v)
        self.eu = np.array(us, dtype=np.int32)
        self.ev = np.array(vs, dtype=np.int32)
        # FR ideal edge length
        area = width * height
        self.k = math.sqrt(area / max(1, self.n)) * 0.9   # slight pull-together
        # Initial temperature = canvas "reach"; decays each step.
        self.t_max = min(width, height) / 16.0
        self.t_min = 0.3
        self.iter = 0

    def step(self, iters_total=220):
        prog = min(1.0, self.iter / iters_total)
        temp = self.t_max * (1 - prog) + self.t_min * prog
        self.iter += 1

        pos = self.pos
        n = self.n
        k = self.k

        # Repulsion: only within a cutoff distance to prevent disconnected
        # components from blowing each other to the canvas edges.
        cutoff = k * 6
        diff = pos[:, None, :] - pos[None, :, :]                # (n,n,2)
        d = np.sqrt((diff * diff).sum(axis=2)) + 1e-3            # (n,n)
        inv = (k * k) / d                                        # (n,n)
        np.fill_diagonal(inv, 0.0)
        inv[d > cutoff] = 0.0
        unit = diff / d[:, :, None]
        rep = (unit * inv[:, :, None]).sum(axis=1)               # (n,2)

        # Attraction along edges: f = d^2 / k in the direction toward partner
        ev = pos[self.ev] - pos[self.eu]                         # (E,2)
        ed = np.sqrt((ev * ev).sum(axis=1)) + 1e-3               # (E,)
        mag = (ed * ed) / k                                      # (E,)
        dir_ = ev / ed[:, None]                                  # (E,2) unit u->v
        att = np.zeros_like(pos)
        np.add.at(att, self.eu,  dir_ * mag[:, None])            # u pulled toward v
        np.add.at(att, self.ev, -dir_ * mag[:, None])            # v pulled toward u

        # Gravity toward center — keeps layout centered
        cx = self.width * 0.5
        cy = self.height * 0.5
        gravity = np.empty_like(pos)
        gravity[:, 0] = (cx - pos[:, 0]) * 0.005
        gravity[:, 1] = (cy - pos[:, 1]) * 0.005

        disp = rep + att + gravity
        dmag = np.linalg.norm(disp, axis=1) + 1e-9
        cap = np.minimum(dmag, temp) / dmag
        disp = disp * cap[:, None]

        pos = pos + disp
        self.pos = pos
        return [(float(x), float(y)) for x, y in pos]

    def fit_to_canvas(self):
        """Rescale positions to fill the canvas with padding. Call once after
        all iterations are done."""
        pos = self.pos
        pad = 40
        xmin, xmax = pos[:, 0].min(), pos[:, 0].max()
        ymin, ymax = pos[:, 1].min(), pos[:, 1].max()
        xspan = xmax - xmin if xmax > xmin else 1.0
        yspan = ymax - ymin if ymax > ymin else 1.0
        target_w = self.width - 2 * pad
        target_h = self.height - 2 * pad
        scale = min(target_w / xspan, target_h / yspan)
        pos[:, 0] = (pos[:, 0] - xmin) * scale + pad + (target_w - xspan * scale) * 0.5
        pos[:, 1] = (pos[:, 1] - ymin) * scale + pad + (target_h - yspan * scale) * 0.5
        self.pos = pos
        return [(float(x), float(y)) for x, y in pos]


def run(graph, width, height, iterations=220, seed=0):
    st = LayoutState(graph, width, height, seed)
    for _ in range(iterations):
        st.step(iters_total=iterations)
    st.fit_to_canvas()
    graph.pos = [(float(x), float(y)) for x, y in st.pos]
    return graph.pos

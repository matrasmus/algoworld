"""AlgoWorld — Social Media Algorithm Simulation Game.

Run with: python main.py

Flow:
  1. Welcome screen
  2. Name entry
  3. Knob tutorial (mandatory)
  4. Design phase — set knobs
  5. Build network
  6. Play — 3 posts
  7. Showboard — full Platform Map
"""

import json
import math
import os
import random
import sys

os.environ["SDL_AUDIODRIVER"] = "dummy"

import pygame

import config as C
from topics import TOPICS, NUM_TOPICS, AFFINITY
from posts import draw_posts, BADGE_COLORS, BADGE_LABEL
import network
import layout
import cascade
import scoring


pygame.init()
pygame.display.set_caption("AlgoWorld")

info = pygame.display.Info()
C.SCREEN_W = info.current_w
C.SCREEN_H = info.current_h
screen = pygame.display.set_mode((C.SCREEN_W, C.SCREEN_H), pygame.RESIZABLE)
clock = pygame.time.Clock()

SHOWBOARD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "showboard.json")

TUTORIAL_STEPS = [
    {
        "knob": "alpha",
        "keys": (pygame.K_q, pygame.K_a),
        "title": "Knob 1: Friends' Picks vs Similar Stuff",
        "explain": "Watch the bridges between communities. Turning this up makes the algorithm recommend by similarity — cross-community connections fade away.",
        "hint": "Try it yourself with Q / A. Then press SPACE.",
    },
    {
        "knob": "beta",
        "keys": (pygame.K_w, pygame.K_s),
        "title": "Knob 2: Superstars vs Everyone Equal",
        "explain": "Watch the node sizes and edge thickness. Turning this up flattens the playing field — big hubs lose their outsized reach and thick highways thin out.",
        "hint": "Try it yourself with W / S. Then press SPACE.",
    },
    {
        "knob": "delta",
        "keys": (pygame.K_e, pygame.K_d),
        "title": "Knob 3: Anything Goes vs Strict Rules",
        "explain": "Watch the bridge edges (red). Turning this up censors controversial bridge-nodes — the network fragments into isolated bubbles.",
        "hint": "Try it yourself with E / D. Then press SPACE.",
    },
]


def sx(frac):
    return int(frac * C.SCREEN_W)


def sy(frac):
    return int(frac * C.SCREEN_H)


def scale():
    return min(C.SCREEN_W / C.REF_W, C.SCREEN_H / C.REF_H)


def sp(ref_px):
    return int(ref_px * scale())


def make_fonts():
    s = scale()
    return {
        "L":  pygame.font.SysFont("consolas", max(16, int(38 * s)), bold=True),
        "M":  pygame.font.SysFont("consolas", max(12, int(22 * s))),
        "S":  pygame.font.SysFont("consolas", max(10, int(18 * s))),
        "XS": pygame.font.SysFont("consolas", max(9, int(14 * s))),
    }


FONTS = make_fonts()


def text(surf, s, font_key, color, pos, center=False):
    font = FONTS[font_key] if isinstance(font_key, str) else font_key
    img = font.render(s, True, color)
    r = img.get_rect()
    if center:
        r.center = pos
    else:
        r.topleft = pos
    surf.blit(img, r)
    return r


def affinity_color(aff):
    if aff < 0:
        return (230, 50, 40)
    if aff == 0:
        return (90, 90, 100)
    if aff == 1:
        return (80, 200, 80)
    return (40, 240, 60)


def node_radius(deg, ref_max=30, r_min=1.0, r_max=10.0):
    t = min(1.0, deg / ref_max)
    return r_min + (r_max - r_min) * t


def edge_width(deg_u, deg_v, s, ref_max=30):
    d = min(deg_u, deg_v)
    t = min(1.0, d / ref_max)
    w = (1.0 + t * (C.EDGE_THICK_MAX - 1.0)) * s
    return max(1, min(C.EDGE_THICK_MAX, int(round(w))))


# --- Showboard persistence ---

def load_showboard():
    try:
        with open(SHOWBOARD_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_showboard(entries):
    with open(SHOWBOARD_FILE, "w") as f:
        json.dump(entries, f, indent=2)


QUADRANT_LABELS = {
    "top_right": ("Echo Paradise", "Everyone agrees. Comfortable — but is anyone being challenged?"),
    "top_left":  ("Cozy Bubble", "Small circles, happy people. But the rest of the world doesn't exist."),
    "bot_right": ("Rage Machine", "Everyone saw it, nobody liked it. Engagement farming at its finest."),
    "bot_left":  ("Dead Platform", "Nothing spreads, nobody's happy. Did you even build an algorithm?"),
}


class Game:
    def __init__(self):
        self.state = "welcome"
        self.alpha = 0.5
        self.beta = 0.5
        self.delta = 0.5
        self.graph = None
        self.rng = random.Random()
        self.posts = []
        self.post_idx = 0
        self.seed_node = None
        self.cascade_steps = []
        self.activated_so_far = set()
        self.cascade_step_i = 0
        self.cascade_time = 0
        self.post_result = None
        self.post_results = []
        self.sub = "seeding"
        self.build_iters_done = 0
        self.node_radius = []

        self.zoom = 1.0
        self.pan = [0.0, 0.0]
        self.dragging = False
        self.drag_last = (0, 0)

        self.preview_graph = None
        self.preview_state = None
        self.preview_radius = []
        self.preview_degs = []
        self.knobs_dirty_since = 0
        self.preview_params = None
        self.now_ms = 0
        self._prev_knobs = (self.alpha, self.beta, self.delta)

        self.showboard = load_showboard()
        self.player_name = ""
        self.current_entry = None

        # Tutorial
        self.tutorial_step = 0
        self.tutorial_phase = "animate"
        self.tutorial_anim_t = 0.0

    def preview_area(self):
        px = sx(0.40)
        py = sy(0.18)
        pw = C.SCREEN_W - px - sp(40)
        ph = C.SCREEN_H - py - sp(60)
        return pygame.Rect(px, py, pw, ph)

    # --- State transitions ---

    def start_build(self):
        self.graph = network.generate(self.alpha, self.beta, self.delta,
                                      seed=self.rng.randint(0, 1 << 30))
        self.layout_state = layout.LayoutState(self.graph, C.SCREEN_W, C.SCREEN_H,
                                               seed=self.rng.randint(0, 1 << 30))
        self.graph.pos = [(float(x), float(y)) for x, y in self.layout_state.pos]
        degs = [len(a) for a in self.graph.adj]
        self.node_radius = [node_radius(d, ref_max=35, r_min=1.0, r_max=10.0) for d in degs]
        self.build_iters_total = 300
        self.build_iters_done = 0
        self.reset_camera()
        self.posts = draw_posts(self.rng)
        self.post_idx = 0
        self.post_results = []
        self.seed_node = None
        self.state = "building"

    def start_knob_tutorial(self):
        self.state = "knob_tutorial"
        self.tutorial_step = 0
        self.tutorial_phase = "animate"
        self.tutorial_anim_t = 0.0
        self.alpha = 0.0
        self.beta = 0.0
        self.delta = 0.0
        self._prev_knobs = (self.alpha, self.beta, self.delta)
        self.ensure_preview()

    def advance_knob_tutorial(self):
        knob_attr = TUTORIAL_STEPS[self.tutorial_step]["knob"]
        setattr(self, knob_attr, 0.5)
        self.tutorial_step += 1
        if self.tutorial_step >= len(TUTORIAL_STEPS):
            self.alpha = 0.5
            self.beta = 0.5
            self.delta = 0.5
            self.state = "design"
            self._prev_knobs = (self.alpha, self.beta, self.delta)
            self.regen_preview()
        else:
            self.tutorial_phase = "animate"
            self.tutorial_anim_t = 0.0
            next_attr = TUTORIAL_STEPS[self.tutorial_step]["knob"]
            setattr(self, next_attr, 0.0)
            self._prev_knobs = (self.alpha, self.beta, self.delta)

    def finish_game(self):
        avg_reach = sum(r["reach_pct"] for r in self.post_results) / len(self.post_results)
        avg_sat = sum(r["satisfaction_pct"] for r in self.post_results) / len(self.post_results)
        entry = {
            "name": self.player_name.strip(),
            "reach": avg_reach,
            "satisfaction": avg_sat,
            "alpha": round(self.alpha, 2),
            "beta": round(self.beta, 2),
            "delta": round(self.delta, 2),
        }
        self.current_entry = entry
        self.showboard.append(entry)
        save_showboard(self.showboard)
        self.state = "showboard"

    # --- Camera ---
    def world_to_screen(self, x, y):
        return x * self.zoom + self.pan[0], y * self.zoom + self.pan[1]

    def screen_to_world(self, sx, sy):
        return (sx - self.pan[0]) / self.zoom, (sy - self.pan[1]) / self.zoom

    def zoom_at(self, mx, my, factor):
        wx, wy = self.screen_to_world(mx, my)
        new_zoom = max(0.3, min(6.0, self.zoom * factor))
        self.zoom = new_zoom
        self.pan[0] = mx - wx * new_zoom
        self.pan[1] = my - wy * new_zoom

    def reset_camera(self):
        self.zoom = 1.0
        self.pan = [0.0, 0.0]

    # --- Resize ---
    def on_resize(self, w, h):
        global screen, FONTS
        C.SCREEN_W = w
        C.SCREEN_H = h
        screen = pygame.display.set_mode((w, h), pygame.RESIZABLE)
        FONTS = make_fonts()
        if self.graph and self.graph.pos and self.state in ("built", "play"):
            self.layout_state = layout.LayoutState(self.graph, w, h, seed=0)
            self.layout_state.pos[:] = [[x, y] for x, y in self.graph.pos]
            self.layout_state.fit_to_canvas()
            self.graph.pos = [(float(x), float(y)) for x, y in self.layout_state.pos]
            self.reset_camera()

    # --- Input ---

    def handle_knobs(self, dt):
        keys = pygame.key.get_pressed()
        step = C.KNOB_SPEED * dt
        if keys[pygame.K_q]: self.alpha = max(0.0, self.alpha - step)
        if keys[pygame.K_a]: self.alpha = min(1.0, self.alpha + step)
        if keys[pygame.K_w]: self.beta  = max(0.0, self.beta  - step)
        if keys[pygame.K_s]: self.beta  = min(1.0, self.beta  + step)
        if keys[pygame.K_e]: self.delta = max(0.0, self.delta - step)
        if keys[pygame.K_d]: self.delta = min(1.0, self.delta + step)

    def handle_tutorial_knob(self, dt):
        keys = pygame.key.get_pressed()
        step = C.KNOB_SPEED * dt
        ts = TUTORIAL_STEPS[self.tutorial_step]
        k_down, k_up = ts["keys"]
        attr = ts["knob"]
        v = getattr(self, attr)
        if keys[k_down]: v = max(0.0, v - step)
        if keys[k_up]:   v = min(1.0, v + step)
        setattr(self, attr, v)

    def handle_event(self, e):
        if e.type == pygame.QUIT:
            pygame.quit(); sys.exit()
        if e.type == pygame.VIDEORESIZE:
            self.on_resize(e.w, e.h)
            return
        if e.type == pygame.KEYDOWN:
            if e.key == pygame.K_ESCAPE:
                if self.state == "name_entry":
                    pass
                elif self.state == "play" and self.sub == "inspect":
                    self.seed_node = None
                    self.sub = "seeding"
                else:
                    pygame.quit(); sys.exit()
            if e.key == pygame.K_r:
                self.reset_camera()
            if e.key == pygame.K_F11:
                pygame.display.toggle_fullscreen()
                info = pygame.display.Info()
                self.on_resize(info.current_w, info.current_h)

            # Name entry
            if self.state == "name_entry":
                if e.key == pygame.K_BACKSPACE:
                    self.player_name = self.player_name[:-1]
                elif e.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
                    if self.player_name.strip():
                        self.start_knob_tutorial()
                elif e.unicode and len(self.player_name) < 12 and e.unicode.isprintable():
                    self.player_name += e.unicode
                return

            if self.state == "welcome" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                self.state = "name_entry"
                self.player_name = ""

            elif self.state == "knob_tutorial":
                if self.tutorial_phase == "free" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                    self.advance_knob_tutorial()

            elif self.state == "design" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                self.start_build()

            elif self.state == "built" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                self.state = "play"
                self.sub = "seeding"

            elif self.state == "play":
                if self.sub == "inspect" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                    self.confirm_seed()
                elif self.sub == "result" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                    self.advance_post()

            elif self.state == "showboard" and e.key in (pygame.K_SPACE, pygame.K_RETURN):
                self.state = "welcome"
                self.player_name = ""
                self.current_entry = None

        if e.type == pygame.MOUSEBUTTONDOWN:
            if e.button == 1:
                if self.state == "play" and self.sub == "seeding":
                    self.inspect_node(e.pos)
                elif self.state == "play" and self.sub == "inspect":
                    clicked = self.node_at(e.pos)
                    if clicked is not None and clicked != self.seed_node:
                        self.inspect_node(e.pos)
                    elif clicked == self.seed_node:
                        self.confirm_seed()
            elif e.button == 3:
                self.dragging = True
                self.drag_last = e.pos
            elif e.button == 4:
                self.zoom_at(e.pos[0], e.pos[1], 1.15)
            elif e.button == 5:
                self.zoom_at(e.pos[0], e.pos[1], 1 / 1.15)
        if e.type == pygame.MOUSEBUTTONUP and e.button == 3:
            self.dragging = False
        if e.type == pygame.MOUSEMOTION and self.dragging:
            dx = e.pos[0] - self.drag_last[0]
            dy = e.pos[1] - self.drag_last[1]
            self.pan[0] += dx; self.pan[1] += dy
            self.drag_last = e.pos
        if e.type == pygame.MOUSEWHEEL:
            mx, my = pygame.mouse.get_pos()
            factor = 1.15 ** e.y
            self.zoom_at(mx, my, factor)

    # --- Game logic ---

    def node_at(self, pos):
        best = None; bd = 1e9
        for i, (x, y) in enumerate(self.graph.pos):
            sx, sy = self.world_to_screen(x, y)
            hit = (self.node_radius[i] * self.zoom + 4) ** 2
            d = (sx - pos[0]) ** 2 + (sy - pos[1]) ** 2
            if d < bd and d < hit:
                bd = d; best = i
        return best

    def inspect_node(self, pos):
        i = self.node_at(pos)
        if i is None: return
        self.seed_node = i
        self.sub = "inspect"

    def confirm_seed(self):
        i = self.seed_node
        if i is None: return
        post = self.posts[self.post_idx]
        result, steps, activated = scoring.score_post_stable(
            self.graph, i, post["topic"], C.N, cascade.run, self.rng,
            alpha=self.alpha, beta=self.beta
        )
        result["feedback"] = scoring.feedback_text(result)
        self.cascade_steps = steps
        self.stable_result = result
        self.stable_activated = activated
        self.activated_so_far = set()
        self.cascade_step_i = 0
        self.cascade_time = 0
        self.sub = "cascade"

    def advance_post(self):
        self.post_results.append(self.post_result)
        self.activated_so_far = set()
        self.post_idx += 1
        if self.post_idx >= C.NUM_POSTS:
            self.finish_game()
        else:
            self.seed_node = None
            self.sub = "seeding"

    # --- Live preview ---
    def ensure_preview(self):
        self.regen_preview()

    def regen_preview(self):
        a, b, d = self.alpha, self.beta, self.delta
        original_N = C.N
        original_avg = C.AVG_DEGREE
        original_max_deg = C.MAX_DEGREE
        original_comm = C.NUM_COMMUNITIES
        original_min_cs = C.MIN_COMMUNITY_SIZE
        original_max_cs = C.MAX_COMMUNITY_SIZE
        try:
            C.N = 120
            C.AVG_DEGREE = 9
            C.MAX_DEGREE = int(12 + 68 * (1 - b))
            C.NUM_COMMUNITIES = original_comm
            C.MIN_COMMUNITY_SIZE = 20
            C.MAX_COMMUNITY_SIZE = 50
            g = network.generate(a, b, d, seed=self.rng.randint(0, 1 << 30))
        finally:
            C.N = original_N
            C.AVG_DEGREE = original_avg
            C.MAX_DEGREE = original_max_deg
            C.NUM_COMMUNITIES = original_comm
            C.MIN_COMMUNITY_SIZE = original_min_cs
            C.MAX_COMMUNITY_SIZE = original_max_cs
        self.preview_graph = g
        ar = self.preview_area()
        self.preview_state = layout.LayoutState(g, ar.width, ar.height, seed=0)
        self.preview_iters_total = 300
        for _ in range(self.preview_iters_total):
            self.preview_state.step(iters_total=self.preview_iters_total)
        self.preview_state.fit_to_canvas()
        degs = [len(adj) for adj in g.adj]
        self.preview_radius = [node_radius(dg, ref_max=30, r_min=1.5, r_max=12.0) for dg in degs]
        self.preview_degs = degs
        self.preview_params = (a, b, d)

    def step_preview(self):
        if self.preview_state is None: return
        if self.preview_state.iter >= self.preview_iters_total: return
        for _ in range(5):
            self.preview_state.step(iters_total=self.preview_iters_total)

    def maybe_regen_preview(self):
        knobs = (self.alpha, self.beta, self.delta)
        if knobs != self._prev_knobs:
            self._prev_knobs = knobs
            self.knobs_dirty_since = self.now_ms
            return
        if self.knobs_dirty_since and self.now_ms - self.knobs_dirty_since > 150:
            if self.preview_params != knobs:
                self.regen_preview()
            self.knobs_dirty_since = 0

    # --- Update ---

    def update(self, dt, ms):
        self.now_ms = pygame.time.get_ticks()
        if self.state == "knob_tutorial":
            if self.tutorial_phase == "animate":
                self.tutorial_anim_t += dt / C.TUTORIAL_ANIM_DURATION
                if self.tutorial_anim_t >= 1.0:
                    self.tutorial_anim_t = 1.0
                    self.tutorial_phase = "free"
                knob_attr = TUTORIAL_STEPS[self.tutorial_step]["knob"]
                setattr(self, knob_attr, min(1.0, self.tutorial_anim_t))
            elif self.tutorial_phase == "free":
                self.handle_tutorial_knob(dt)
            self.maybe_regen_preview()
            self.step_preview()
        elif self.state == "design":
            self.handle_knobs(dt)
            self.maybe_regen_preview()
            self.step_preview()
        elif self.state == "building":
            iters_per_frame = 6
            for _ in range(iters_per_frame):
                self.graph.pos = self.layout_state.step(iters_total=self.build_iters_total)
                self.build_iters_done += 1
                if self.build_iters_done >= self.build_iters_total:
                    self.graph.pos = self.layout_state.fit_to_canvas()
                    self.state = "built"
                    break
        elif self.state == "play" and self.sub == "cascade":
            self.cascade_time += ms
            while self.cascade_step_i < len(self.cascade_steps) and self.cascade_time >= C.CASCADE_STEP_MS:
                self.cascade_time -= C.CASCADE_STEP_MS
                self.activated_so_far.update(self.cascade_steps[self.cascade_step_i])
                self.cascade_step_i += 1
            if self.cascade_step_i >= len(self.cascade_steps) and self.cascade_time > 300:
                self.post_result = self.stable_result
                self.sub = "result"

    # --- Drawing ---

    def draw(self):
        screen.fill(C.BG)
        if self.state == "welcome":       self.draw_welcome()
        elif self.state == "name_entry":  self.draw_name_entry()
        elif self.state == "knob_tutorial": self.draw_knob_tutorial()
        elif self.state == "design":      self.draw_design()
        elif self.state == "building":    self.draw_network(title="Building the network...")
        elif self.state == "built":       self.draw_network(title="Your platform is live. Press SPACE.")
        elif self.state == "play":        self.draw_play()
        elif self.state == "showboard":   self.draw_showboard()
        pygame.display.flip()

    def draw_welcome(self):
        W, H = C.SCREEN_W, C.SCREEN_H
        text(screen, "AlgoWorld", "L", C.ACCENT, (W // 2, sy(0.29)), center=True)
        text(screen, "Design a social-media platform. Then try to go viral on it.",
             "M", C.TEXT, (W // 2, sy(0.36)), center=True)
        text(screen, "You are the algorithm. What kind of feed do you create?",
             "S", C.MUTED, (W // 2, sy(0.40)), center=True)
        text(screen, "Press SPACE to start  ·  ESC to quit  ·  F11 fullscreen",
             "M", C.TEXT, (W // 2, sy(0.62)), center=True)

    def draw_name_entry(self):
        W, H = C.SCREEN_W, C.SCREEN_H
        text(screen, "What's your name?", "L", C.ACCENT, (W // 2, sy(0.35)), center=True)
        text(screen, "You'll be placed on the Platform Map.", "S", C.MUTED, (W // 2, sy(0.42)), center=True)

        box_w = sp(300)
        box_h = sp(50)
        box_x = W // 2 - box_w // 2
        box_y = sy(0.50)
        pygame.draw.rect(screen, C.PANEL, (box_x, box_y, box_w, box_h), border_radius=sp(8))
        pygame.draw.rect(screen, C.ACCENT, (box_x, box_y, box_w, box_h), width=2, border_radius=sp(8))

        display_name = self.player_name
        blink = (self.now_ms // 500) % 2 == 0
        if blink:
            display_name += "_"
        text(screen, display_name, "M", C.TEXT, (box_x + sp(16), box_y + sp(12)))
        text(screen, "Type your name (max 12 chars), then press ENTER",
             "S", C.MUTED, (W // 2, box_y + box_h + sp(30)), center=True)

    def draw_knob_tutorial(self):
        W, H = C.SCREEN_W, C.SCREEN_H
        ts = TUTORIAL_STEPS[self.tutorial_step]

        text(screen, f"Algorithm Tutorial — Step {self.tutorial_step + 1} of {len(TUTORIAL_STEPS)}",
             "L", C.ACCENT, (W // 2, sy(0.04)), center=True)
        text(screen, ts["title"], "M", C.TEXT, (W // 2, sy(0.09)), center=True)

        self.draw_wrapped_centered(ts["explain"], FONTS["S"], C.TEXT, (W // 2, sy(0.13)), sx(0.85))

        knobs_data = [
            ("Knob 1  (Q / A)", "Friends' Picks", "Similar Stuff", self.alpha),
            ("Knob 2  (W / S)", "Superstars", "Everyone Equal", self.beta),
            ("Knob 3  (E / D)", "Anything Goes", "Strict Rules", self.delta),
        ]
        panel_x = sp(40)
        panel_w = sx(0.36)
        knob_h = sp(120)
        knob_spacing = min(sp(140), (H - sy(0.22) - sp(80)) // 3)

        for i, (hdr, l, r, v) in enumerate(knobs_data):
            y = sy(0.22) + i * knob_spacing
            is_active = (i == self.tutorial_step)
            bg_col = C.PANEL if is_active else C.PANEL_DIM
            accent_col = C.ACCENT if is_active else (60, 60, 80)

            pygame.draw.rect(screen, bg_col, (panel_x, y, panel_w, knob_h), border_radius=sp(8))
            if is_active:
                pygame.draw.rect(screen, C.ACCENT, (panel_x, y, panel_w, knob_h), width=2, border_radius=sp(8))
            text(screen, hdr, "M", accent_col, (panel_x + sp(16), y + sp(10)))

            tx = panel_x + sp(16)
            ty = y + knob_h - sp(40)
            tw = panel_w - sp(32)
            pygame.draw.rect(screen, (60, 60, 80), (tx, ty, tw, sp(8)), border_radius=sp(4))
            knob_px = tx + int(v * tw)
            pygame.draw.circle(screen, accent_col, (knob_px, ty + sp(4)), sp(10))
            text(screen, l, "XS", C.MUTED, (tx, ty + sp(16)))
            rw = FONTS["XS"].size(r)[0]
            text(screen, r, "XS", C.MUTED, (tx + tw - rw, ty + sp(16)))

        self.draw_preview(tutorial_step=self.tutorial_step)

        if self.tutorial_step == 1 and self.preview_degs:
            ar = self.preview_area()
            degs = self.preview_degs
            superstars = sum(1 for d in degs if d > 20)
            max_deg = max(degs)
            stat_y = ar.y + ar.height - sp(60)
            pygame.draw.rect(screen, (18, 18, 24), (ar.x + sp(8), stat_y, sp(220), sp(55)), border_radius=sp(4))
            text(screen, f"Superstars (deg>20): {superstars}", "S", C.ACCENT, (ar.x + sp(14), stat_y + sp(6)))
            text(screen, f"Biggest hub: {max_deg} connections", "S", C.ACCENT, (ar.x + sp(14), stat_y + sp(28)))

        if self.tutorial_phase == "animate":
            text(screen, "Watch the network change...", "M", C.MUTED, (W // 2, H - sp(30)), center=True)
        else:
            text(screen, ts["hint"], "M", C.TEXT, (W // 2, H - sp(30)), center=True)

    def draw_wrapped_centered(self, s, font, color, pos, max_w):
        words = s.split()
        lines = []
        line = ""
        for w in words:
            test = (line + " " + w).strip()
            if font.size(test)[0] > max_w and line:
                lines.append(line)
                line = w
            else:
                line = test
        if line:
            lines.append(line)
        lh = font.get_height() + 2
        cx, start_y = pos
        for i, ln in enumerate(lines):
            text(screen, ln, font, color, (cx, start_y + i * lh), center=True)

    def draw_design(self):
        W, H = C.SCREEN_W, C.SCREEN_H
        text(screen, "You are TikTok. You decide how the algorithm works.",
             "L", C.TEXT, (W // 2, sy(0.07)), center=True)
        text(screen, "Adjust the three dials. Watch your network change. SPACE to launch.",
             "S", C.MUTED, (W // 2, sy(0.12)), center=True)

        knobs = [
            ("Knob 1  (Q / A)", "Friends' Picks", "Similar Stuff",
             "Network-based vs. content-based recommendations.", self.alpha),
            ("Knob 2  (W / S)", "Superstars", "Everyone Equal",
             "Flat visibility vs. hub-driven virality.", self.beta),
            ("Knob 3  (E / D)", "Anything Goes", "Strict Rules",
             "No moderation vs. pruning of controversial bridges.", self.delta),
        ]
        panel_x = sp(40)
        panel_w = sx(0.36)
        knob_h = sp(180)
        knob_spacing = min(
            (H - sy(0.18) - sp(50) - knob_h) // max(1, len(knobs) - 1) + knob_h,
            sp(210),
        )

        for i, (hdr, l, r, desc, v) in enumerate(knobs):
            y = sy(0.18) + i * knob_spacing
            pygame.draw.rect(screen, C.PANEL, (panel_x, y, panel_w, knob_h), border_radius=sp(8))
            text(screen, hdr, "M", C.ACCENT, (panel_x + sp(20), y + sp(12)))
            text(screen, desc, "S", C.MUTED, (panel_x + sp(20), y + sp(44)))
            tx = panel_x + sp(20)
            ty = y + knob_h - sp(60)
            tw = panel_w - sp(40)
            pygame.draw.rect(screen, (60, 60, 80), (tx, ty, tw, sp(10)), border_radius=sp(5))
            knob_px = tx + int(v * tw)
            pygame.draw.circle(screen, C.ACCENT, (knob_px, ty + sp(5)), sp(12))
            text(screen, l, "XS", C.MUTED, (tx, ty + sp(22)))
            rw = FONTS["XS"].size(r)[0]
            text(screen, r, "XS", C.MUTED, (tx + tw - rw, ty + sp(22)))
            text(screen, f"{v:.2f}", "S", C.TEXT, (tx + tw // 2, ty - sp(22)), center=True)

        self.draw_preview()
        text(screen, "SPACE  Launch your platform", "M", C.TEXT,
             (W // 2, H - sp(30)), center=True)

    def draw_network(self, title=None, show_activated=False,
                     seed_node=None, inspect_node=None):
        g = self.graph
        if g is None: return
        z = self.zoom
        px, py = self.pan
        s = scale()
        degs = [len(a) for a in g.adj]
        neighbors = g.adj[inspect_node] if inspect_node is not None else set()

        for u, nbrs in enumerate(g.adj):
            x0, y0 = g.pos[u]; sx0 = x0 * z + px; sy0 = y0 * z + py
            for v in nbrs:
                if v <= u: continue
                x1, y1 = g.pos[v]; sx1 = x1 * z + px; sy1 = y1 * z + py
                if inspect_node is not None and (u == inspect_node or v == inspect_node):
                    col = (255, 255, 255)
                    w = max(2, edge_width(degs[u], degs[v], s * z) + 1)
                elif inspect_node is not None:
                    col = (30, 30, 40)
                    w = 1
                else:
                    col = (50, 50, 65)
                    w = edge_width(degs[u], degs[v], s * z)
                if w <= 1:
                    pygame.draw.aaline(screen, col, (sx0, sy0), (sx1, sy1))
                else:
                    pygame.draw.line(screen, col, (int(sx0), int(sy0)), (int(sx1), int(sy1)), w)

        radii = self.node_radius
        for i, (x, y) in enumerate(g.pos):
            col = TOPICS[g.topic[i]]["color"]
            r = radii[i] * z * s
            sat_ring = None
            if show_activated and i in self.activated_so_far:
                post_topic = self.posts[self.post_idx]["topic"]
                a = AFFINITY[post_topic][g.topic[i]]
                sat_ring = affinity_color(a)
                r = (radii[i] + 2) * z * s
            if inspect_node is not None and i != inspect_node and i not in neighbors:
                col = tuple(c // 4 for c in col)
            scx, scy = x * z + px, y * z + py
            ri = max(1, int(round(r)))
            if sat_ring:
                ring_r = ri + max(2, int(3 * z * s))
                pygame.draw.circle(screen, sat_ring, (int(scx), int(scy)), ring_r)
            pygame.draw.circle(screen, col, (int(scx), int(scy)), ri)

        if seed_node is not None:
            x, y = g.pos[seed_node]
            scx, scy = x * z + px, y * z + py
            pygame.draw.circle(screen, (255, 255, 255), (int(scx), int(scy)), int(sp(10) * z + 2), 2)

        if title:
            text(screen, title, "M", C.TEXT, (C.SCREEN_W // 2, sp(30)), center=True)

        self.draw_community_legend()
        self.draw_camera_hint()

    def draw_camera_hint(self):
        text(screen, "scroll: zoom · right-drag: pan · R: reset · F11: fullscreen",
             "XS", C.MUTED, (sp(12), C.SCREEN_H - sp(22)))

    def draw_preview(self, tutorial_step=None):
        ar = self.preview_area()
        pygame.draw.rect(screen, (24, 24, 32), ar, border_radius=sp(8))
        pygame.draw.rect(screen, (60, 60, 80), ar, width=1, border_radius=sp(8))
        if self.preview_graph is None: return
        g = self.preview_graph
        pos = self.preview_state.pos
        pw, ph = ar.width, ar.height
        lw, lh = self.preview_state.width, self.preview_state.height
        sx_ratio = pw / lw if lw else 1
        sy_ratio = ph / lh if lh else 1
        ratio = min(sx_ratio, sy_ratio)
        ox = ar.x + (pw - lw * ratio) * 0.5
        oy = ar.y + (ph - lh * ratio) * 0.5
        s = scale()
        degs = self.preview_degs

        for u, nbrs in enumerate(g.adj):
            x0, y0 = pos[u]
            for v in nbrs:
                if v <= u: continue
                x1, y1 = pos[v]
                cross = g.topic[u] != g.topic[v]
                if tutorial_step == 0 and cross:
                    col = C.TUTORIAL_HIGHLIGHT
                elif tutorial_step == 2 and cross:
                    col = C.TUTORIAL_CUT
                else:
                    col = (45, 45, 60)
                w = edge_width(degs[u], degs[v], s) if degs else 1
                p0 = (int(ox + x0 * ratio), int(oy + y0 * ratio))
                p1 = (int(ox + x1 * ratio), int(oy + y1 * ratio))
                if w <= 1:
                    pygame.draw.aaline(screen, col, p0, p1)
                else:
                    pygame.draw.line(screen, col, p0, p1, w)

        for i in range(g.n):
            x, y = pos[i]
            col = TOPICS[g.topic[i]]["color"]
            r = self.preview_radius[i] * s
            pygame.draw.circle(screen, col, (int(ox + x * ratio), int(oy + y * ratio)),
                               max(1, int(round(r))))

        if tutorial_step is None:
            text(screen, "Live preview — network regenerates as you turn the knobs",
                 "XS", C.MUTED, (ar.x + sp(10), ar.y - sp(20)))

    def draw_community_legend(self):
        W = C.SCREEN_W
        for i, t in enumerate(TOPICS):
            y = sp(60) + i * sp(22)
            pygame.draw.circle(screen, t["color"], (W - sp(170), y), max(3, sp(6)))
            text(screen, t["name"], "S", C.TEXT, (W - sp(155), y - sp(11)))

    def draw_play(self):
        post = self.posts[self.post_idx]
        topic = TOPICS[post["topic"]]
        inspect = self.seed_node if self.sub == "inspect" else None
        self.draw_network(show_activated=True,
                          seed_node=self.seed_node, inspect_node=inspect)
        self.draw_post_card(post, topic)

        if self.sub == "cascade":
            reached = len(self.activated_so_far)
            text(screen, f"Reached: {reached} / {C.N}", "M", C.TEXT,
                 (C.SCREEN_W // 2, sp(60)), center=True)

        if self.sub == "seeding":
            text(screen, "Click a node to inspect it.", "M", C.ACCENT,
                 (C.SCREEN_W // 2, sp(60)), center=True)
            mx, my = pygame.mouse.get_pos()
            i = self.node_at((mx, my))
            if i is not None:
                tn = TOPICS[self.graph.topic[i]]["name"]
                text(screen, f"{tn} community", "S", C.TEXT, (mx + sp(12), my - sp(22)))

        if self.sub == "inspect" and self.seed_node is not None:
            text(screen, "SPACE / click again to post here  |  ESC to cancel  |  click another node to switch",
                 "S", C.ACCENT, (C.SCREEN_W // 2, sp(60)), center=True)
            self.draw_inspect_overlay()

        if self.sub == "result":
            self.draw_result_overlay()

    def draw_inspect_overlay(self):
        i = self.seed_node
        g = self.graph
        deg = len(g.adj[i])
        comm_name = TOPICS[g.topic[i]]["name"]
        comm_col = TOPICS[g.topic[i]]["color"]
        nbrs = g.adj[i]
        comm_counts = {}
        for nb in nbrs:
            tn = TOPICS[g.topic[nb]]["name"]
            comm_counts[tn] = comm_counts.get(tn, 0) + 1

        x, y = sp(30), sp(120) + sp(270)
        w = sx(0.24)
        h = sp(30) + sp(24) * (2 + len(comm_counts))
        pygame.draw.rect(screen, C.PANEL, (x, y, w, h), border_radius=sp(10))
        pygame.draw.rect(screen, comm_col, (x, y, w, sp(6)), border_radius=sp(4))
        text(screen, f"{comm_name} node — {deg} connections", "M", C.TEXT, (x + sp(16), y + sp(14)))
        ty = y + sp(48)
        text(screen, "Connected to:", "S", C.MUTED, (x + sp(16), ty))
        ty += sp(24)
        for cn, cnt in sorted(comm_counts.items(), key=lambda t: -t[1]):
            text(screen, f"  {cn}: {cnt}", "S", C.TEXT, (x + sp(16), ty))
            ty += sp(24)

    def draw_post_card(self, post, topic):
        x, y = sp(30), sp(120)
        w = sx(0.24)
        h = sp(260)
        pygame.draw.rect(screen, C.PANEL, (x, y, w, h), border_radius=sp(10))
        pygame.draw.rect(screen, topic["color"], (x, y, w, sp(8)), border_radius=sp(6))
        text(screen, f"Post {self.post_idx + 1} of {C.NUM_POSTS}", "S", C.MUTED, (x + sp(16), y + sp(18)))
        text(screen, post["title"], "M", C.TEXT, (x + sp(16), y + sp(50)))
        text(screen, f"#{topic['name']}", "S", topic["color"], (x + sp(16), y + sp(82)))
        self.draw_wrapped(post["desc"], FONTS["S"], C.TEXT, (x + sp(16), y + sp(120)), w - sp(32))
        kind = post["kind"]
        bc = BADGE_COLORS[kind]
        label = BADGE_LABEL[kind]
        bw = sp(160)
        bx, by = x + w - bw - sp(16), y + h - sp(40)
        pygame.draw.rect(screen, bc, (bx, by, bw, sp(26)), border_radius=sp(13))
        text(screen, label, "S", (10, 10, 20), (bx + bw // 2, by + sp(13)), center=True)

    def draw_wrapped(self, s, font, color, pos, max_w):
        words = s.split()
        line = ""
        x, y = pos
        lh = font.get_height() + 2
        for w in words:
            test = (line + " " + w).strip()
            if font.size(test)[0] > max_w and line:
                text(screen, line, font, color, (x, y))
                y += lh; line = w
            else:
                line = test
        if line:
            text(screen, line, font, color, (x, y))

    def draw_result_overlay(self):
        r = self.post_result
        x = sp(30)
        card_h = sp(260)
        y = sp(120) + card_h + sp(20)
        w = sx(0.24)
        h = sp(260)
        if y + h > C.SCREEN_H - sp(20):
            y = C.SCREEN_H - sp(20) - h
        pygame.draw.rect(screen, C.PANEL, (x, y, w, h), border_radius=sp(10))
        text(screen, "Result", "M", C.ACCENT, (x + sp(16), y + sp(14)))

        text(screen, f"Reach: {r['reach']} / {C.N}  ({r['reach_pct']:.1f}%)",
             "S", C.TEXT, (x + sp(16), y + sp(50)))
        bw = w - sp(32)
        bar_h = sp(10)
        pygame.draw.rect(screen, (60, 60, 80), (x + sp(16), y + sp(76), bw, bar_h), border_radius=sp(5))
        pygame.draw.rect(screen, C.ACCENT, (x + sp(16), y + sp(76), int(bw * r['reach_pct'] / 100), bar_h),
                         border_radius=sp(5))

        text(screen, f"Satisfaction: {r['satisfaction_pct']:.0f}%", "S", C.TEXT, (x + sp(16), y + sp(100)))
        pygame.draw.rect(screen, (60, 60, 80), (x + sp(16), y + sp(126), bw, bar_h), border_radius=sp(5))
        sat = max(0, min(100, r['satisfaction_pct']))
        col = (90, 210, 110) if sat >= 50 else (230, 220, 90) if sat >= 30 else (230, 90, 90)
        pygame.draw.rect(screen, col, (x + sp(16), y + sp(126), int(bw * sat / 100), bar_h), border_radius=sp(5))

        text(screen, f"Communities reached: {r['communities_hit']}", "S", C.MUTED, (x + sp(16), y + sp(150)))
        self.draw_wrapped(r["feedback"], FONTS["S"], C.MUTED, (x + sp(16), y + sp(188)), w - sp(32))

        cue = "SPACE  Next post" if self.post_idx < C.NUM_POSTS - 1 else "SPACE  See results"
        text(screen, cue, "S", C.ACCENT, (x + w // 2, y + h - sp(22)), center=True)

    # --- Showboard ---

    def draw_showboard(self):
        W, H = C.SCREEN_W, C.SCREEN_H
        text(screen, "The Platform Map", "L", C.ACCENT, (W // 2, sy(0.04)), center=True)
        text(screen, "Where does your platform land?", "S", C.MUTED, (W // 2, sy(0.08)), center=True)

        # Post summary cards (left column)
        card_x = sp(30)
        card_w = sx(0.22)
        card_h = sp(70)
        card_gap = sp(8)
        cards_y = sy(0.13)
        for i, r in enumerate(self.post_results):
            p = self.posts[i]
            topic = TOPICS[p["topic"]]
            cy = cards_y + i * (card_h + card_gap)
            pygame.draw.rect(screen, C.PANEL, (card_x, cy, card_w, card_h), border_radius=sp(6))
            pygame.draw.rect(screen, topic["color"], (card_x, cy, card_w, sp(4)), border_radius=sp(4))
            text(screen, f"{BADGE_LABEL[p['kind']]}: {p['title']}", "S", C.TEXT,
                 (card_x + sp(10), cy + sp(10)))
            text(screen, f"Reach {r['reach_pct']:.0f}%   Satisfaction {r['satisfaction_pct']:.0f}%",
                 "XS", C.MUTED, (card_x + sp(10), cy + sp(38)))

        # Scatter plot
        plot_margin_l = sx(0.28)
        plot_margin_r = sp(40)
        plot_margin_t = sy(0.13)
        plot_margin_b = sp(80)
        plot_x = plot_margin_l
        plot_y = plot_margin_t
        plot_w = W - plot_margin_l - plot_margin_r
        plot_h = H - plot_margin_t - plot_margin_b

        self.draw_scatter(plot_x, plot_y, plot_w, plot_h)

        if self.current_entry:
            e = self.current_entry
            if e["satisfaction"] >= 60:
                qkey = "top_right" if e["reach"] >= 30 else "top_left"
            else:
                qkey = "bot_right" if e["reach"] >= 30 else "bot_left"
            _, desc = QUADRANT_LABELS[qkey]
            text(screen, desc, "S", C.MUTED, (W // 2, H - sp(55)), center=True)

        text(screen, "SPACE  Play again", "M", C.TEXT, (W // 2, H - sp(30)), center=True)

    def draw_scatter(self, px, py, pw, ph):
        pygame.draw.rect(screen, (24, 24, 32), (px, py, pw, ph), border_radius=sp(8))

        cx = px + int(0.30 * pw)
        cy = py + ph - int(0.60 * ph)
        pygame.draw.line(screen, (50, 50, 65), (cx, py), (cx, py + ph), 1)
        pygame.draw.line(screen, (50, 50, 65), (px, cy), (px + pw, cy), 1)

        text(screen, "Reach %", "S", C.MUTED, (px + pw // 2, py + ph + sp(8)), center=True)
        text(screen, "Satisfaction %", "S", C.MUTED, (px + sp(4), py - sp(18)))

        text(screen, "0", "XS", C.MUTED, (px + sp(4), py + ph + sp(4)))
        text(screen, "100", "XS", C.MUTED, (px + pw - sp(24), py + ph + sp(4)))
        text(screen, "0", "XS", C.MUTED, (px - sp(20), py + ph - sp(10)))
        text(screen, "100", "XS", C.MUTED, (px - sp(30), py + sp(2)))

        left_cx = px + int(0.15 * pw)
        right_cx = px + int(0.65 * pw)
        top_cy = py + int(0.20 * ph)
        bot_cy = py + ph - int(0.20 * ph)
        quadrants = [
            ("top_right", right_cx, top_cy),
            ("top_left",  left_cx, top_cy),
            ("bot_right", right_cx, bot_cy),
            ("bot_left",  left_cx, bot_cy),
        ]
        for qkey, qx, qy in quadrants:
            name, desc = QUADRANT_LABELS[qkey]
            text(screen, name, "S", (80, 80, 100), (qx, qy - sp(10)), center=True)

        for entry in self.showboard:
            if entry is self.current_entry:
                continue
            ex = px + int(entry["reach"] / 100 * pw)
            ey = py + ph - int(entry["satisfaction"] / 100 * ph)
            r = sp(5)
            pygame.draw.circle(screen, (80, 80, 110), (ex, ey), r)
            text(screen, entry["name"], "XS", (100, 100, 120), (ex + r + sp(4), ey - sp(6)))

        if self.current_entry:
            e = self.current_entry
            ex = px + int(e["reach"] / 100 * pw)
            ey = py + ph - int(e["satisfaction"] / 100 * ph)
            r = sp(8)
            pygame.draw.circle(screen, (120, 200, 255, 60), (ex, ey), r + sp(6), 2)
            pygame.draw.circle(screen, C.ACCENT, (ex, ey), r)
            text(screen, e["name"], "M", C.ACCENT, (ex + r + sp(6), ey - sp(10)))

    # --- Main loop ---

    def run(self):
        while True:
            ms = clock.tick(C.FPS)
            dt = ms / 1000.0
            for e in pygame.event.get():
                self.handle_event(e)
            self.update(dt, ms)
            self.draw()


if __name__ == "__main__":
    Game().run()

"""All tunable constants for AlgoWorld."""

# Reference design resolution — all proportional layout math is relative to this.
REF_W = 1400
REF_H = 900

# Actual screen size — set at startup and updated on resize.
SCREEN_W = REF_W
SCREEN_H = REF_H

FPS = 60

# Network
N = 500
NUM_COMMUNITIES = 4
AVG_DEGREE = 10
MIN_COMMUNITY_SIZE = 80
MAX_COMMUNITY_SIZE = 175

# Knob 1 (alpha) -> mu
MU_MIN = 0.05
MU_MAX = 0.40

# Knob 2 (beta) -> tau1 (degree power-law exponent)
TAU1_MIN = 2.1
TAU1_MAX = 3.5
MIN_DEGREE = 3
MAX_DEGREE = 80

# Knob 3 (delta) -> censorship threshold
CENSOR_MIN = 0.2
CENSOR_MAX = 1.0

# Controversy
CONTROVERSY_BETA_A = 2
CONTROVERSY_BETA_B = 5
BRIDGE_CONTROVERSY_BOOST = 0.3

# ICM
P_BASE = 0.15
RELEVANCE_TARGET = 3.0
RELEVANCE_POSITIVE = 1.5
RELEVANCE_NEUTRAL = 1.0
RELEVANCE_OPPOSED = 0.6
EDGE_FACTOR_SAME = 1.0
EDGE_FACTOR_CROSS = 0.45

# Affinity scoring
AFFINITY_TARGET = 2
AFFINITY_POSITIVE = 1
AFFINITY_NEUTRAL = 0
AFFINITY_OPPOSED = -1

# Animation
CASCADE_STEP_MS = 400
LAYOUT_ITERATIONS = 300

# Game
NUM_POSTS = 3

# Input
KNOB_SPEED = 0.6  # units per second while held (0..1 range)

# Edge thickness
EDGE_THICK_SCALE = 0.8
EDGE_THICK_MAX = 4

# Tutorial
TUTORIAL_ANIM_DURATION = 2.0  # seconds per knob auto-animation

# Colors
BG = (18, 18, 24)
PANEL = (30, 30, 40)
PANEL_DIM = (22, 22, 30)
TEXT = (235, 235, 240)
MUTED = (140, 140, 160)
ACCENT = (120, 200, 255)
EDGE_COLOR = (80, 80, 100, 80)
TUTORIAL_HIGHLIGHT = (0, 255, 200)
TUTORIAL_CUT = (255, 60, 60)

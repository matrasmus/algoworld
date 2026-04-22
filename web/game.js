const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let W, H;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
}
resize();
window.addEventListener("resize", resize);

function sc() { return Math.min(W / CONFIG.REF_W, H / CONFIG.REF_H); }
function sp(ref) { return Math.round(ref * sc()); }
function sx(frac) { return Math.round(frac * W); }
function sy(frac) { return Math.round(frac * H); }

function rgb(r, g, b) { return `rgb(${r},${g},${b})`; }
function rgba(r, g, b, a) { return `rgba(${r},${g},${b},${a})`; }

function affinityColor(aff) {
  if (aff < 0) return rgb(230, 50, 40);
  if (aff === 0) return rgb(90, 90, 100);
  if (aff === 1) return rgb(80, 200, 80);
  return rgb(40, 240, 60);
}

function nodeRadius(deg, refMax, rMin, rMax) {
  refMax = refMax || 30; rMin = rMin || 1; rMax = rMax || 10;
  const t = Math.min(1, deg / refMax);
  return rMin + (rMax - rMin) * t;
}

function edgeWidth(degU, degV, s, refMax) {
  refMax = refMax || 30;
  const d = Math.min(degU, degV);
  const t = Math.min(1, d / refMax);
  const w = (1 + t * (CONFIG.EDGE_THICK_MAX - 1)) * s;
  return Math.max(1, Math.min(CONFIG.EDGE_THICK_MAX, Math.round(w)));
}

const QUADRANT_LABELS = {
  top_right: ["Echo Paradise", "Everyone agrees. Comfortable \u2014 but is anyone being challenged?"],
  top_left:  ["Cozy Bubble", "Small circles, happy people. But the rest of the world doesn't exist."],
  bot_right: ["Rage Machine", "Everyone saw it, nobody liked it. Engagement farming at its finest."],
  bot_left:  ["Dead Platform", "Nothing spreads, nobody's happy. Did you even build an algorithm?"],
};

const TUTORIAL_STEPS = [
  {
    knob: "alpha", keysUp: "q", keysDown: "a",
    title: "Knob 1: Friends' Picks vs Similar Stuff",
    explain: "Watch the bridges between communities. Turning this up makes the algorithm recommend by similarity \u2014 cross-community connections fade away.",
    hint: "Try it yourself with Q / A. Then press SPACE.",
  },
  {
    knob: "beta", keysUp: "w", keysDown: "s",
    title: "Knob 2: Superstars vs Everyone Equal",
    explain: "Watch the node sizes and edge thickness. Turning this up flattens the playing field \u2014 big hubs lose their outsized reach and thick highways thin out.",
    hint: "Try it yourself with W / S. Then press SPACE.",
  },
  {
    knob: "delta", keysUp: "e", keysDown: "d",
    title: "Knob 3: Anything Goes vs Strict Rules",
    explain: "Watch the bridge edges (red). Turning this up censors controversial bridge-nodes \u2014 the network fragments into isolated bubbles.",
    hint: "Try it yourself with E / D. Then press SPACE.",
  },
];

// --- Showboard persistence via localStorage ---
function loadShowboard() {
  try { return JSON.parse(localStorage.getItem("algoworld_showboard")) || []; }
  catch { return []; }
}
function saveShowboard(entries) {
  localStorage.setItem("algoworld_showboard", JSON.stringify(entries));
}

// --- Text drawing helpers ---
function setFont(size, bold) {
  ctx.font = (bold ? "bold " : "") + size + "px Consolas, monospace";
}
function fontSizes() {
  const s = sc();
  return {
    L: Math.max(16, Math.round(38 * s)),
    M: Math.max(12, Math.round(22 * s)),
    S: Math.max(10, Math.round(18 * s)),
    XS: Math.max(9, Math.round(14 * s)),
  };
}
function drawText(txt, sizeKey, color, x, y, center) {
  const fs = fontSizes();
  const size = fs[sizeKey] || fs.M;
  const bold = sizeKey === "L";
  setFont(size, bold);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  if (center) {
    ctx.textAlign = "center";
    ctx.fillText(txt, x, y);
    ctx.textAlign = "left";
  } else {
    ctx.textAlign = "left";
    ctx.fillText(txt, x, y);
  }
}
function measureText(txt, sizeKey) {
  const fs = fontSizes();
  const size = fs[sizeKey] || fs.M;
  setFont(size, sizeKey === "L");
  return ctx.measureText(txt).width;
}
function drawWrapped(txt, sizeKey, color, x, y, maxW) {
  const words = txt.split(" ");
  const fs = fontSizes();
  const size = fs[sizeKey] || fs.M;
  setFont(size, false);
  const lh = size + 4;
  let line = "";
  let cy = y;
  for (const w of words) {
    const test = (line + " " + w).trim();
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillStyle = color;
      ctx.fillText(line, x, cy);
      cy += lh;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillStyle = color;
    ctx.fillText(line, x, cy);
  }
}
function drawWrappedCentered(txt, sizeKey, color, cx, y, maxW) {
  const words = txt.split(" ");
  const fs = fontSizes();
  const size = fs[sizeKey] || fs.M;
  setFont(size, false);
  const lh = size + 4;
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = (line + " " + w).trim();
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, y + i * lh);
  }
  ctx.textAlign = "left";
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ==================== GAME ====================

class Game {
  constructor() {
    this.state = "welcome";
    this.alpha = 0.5;
    this.beta = 0.5;
    this.delta = 0.5;
    this.graph = null;
    this.rng = new SeededRNG(Date.now());
    this.posts = [];
    this.postIdx = 0;
    this.seedNode = null;
    this.cascadeSteps = [];
    this.activatedSoFar = new Set();
    this.cascadeStepI = 0;
    this.cascadeTime = 0;
    this.postResult = null;
    this.postResults = [];
    this.sub = "seeding";
    this.buildItersDone = 0;
    this.nodeRadii = [];

    this.zoom = 1;
    this.pan = [0, 0];
    this.dragging = false;
    this.dragLast = [0, 0];

    this.previewGraph = null;
    this.previewState = null;
    this.previewRadii = [];
    this.previewDegs = [];
    this.knobsDirtySince = 0;
    this.previewParams = null;
    this.nowMs = 0;
    this._prevKnobs = [this.alpha, this.beta, this.delta];

    this.showboard = loadShowboard();
    this.playerName = "";
    this.currentEntry = null;

    this.tutorialStep = 0;
    this.tutorialPhase = "animate";
    this.tutorialAnimT = 0;

    // Keyboard state
    this.keysDown = {};

    // Layout state for building animation
    this.layoutState = null;
    this.buildItersTotal = 300;

    // Hover
    this.mouseX = 0;
    this.mouseY = 0;

    this._setupInput();
    this._lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // --- Input ---
  _setupInput() {
    window.addEventListener("keydown", (e) => {
      this.keysDown[e.key.toLowerCase()] = true;
      this._handleKeyDown(e);
    });
    window.addEventListener("keyup", (e) => {
      this.keysDown[e.key.toLowerCase()] = false;
    });
    canvas.addEventListener("mousedown", (e) => this._handleMouseDown(e));
    canvas.addEventListener("mouseup", (e) => this._handleMouseUp(e));
    canvas.addEventListener("mousemove", (e) => this._handleMouseMove(e));
    canvas.addEventListener("wheel", (e) => this._handleWheel(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _handleKeyDown(e) {
    const key = e.key.toLowerCase();

    if (key === "r") this.resetCamera();
    if (key === "f11") { e.preventDefault(); document.documentElement.requestFullscreen?.(); }

    if (this.state === "name_entry") {
      if (key === "backspace") {
        this.playerName = this.playerName.slice(0, -1);
      } else if (key === "enter") {
        if (this.playerName.trim()) this.startKnobTutorial();
      } else if (e.key.length === 1 && this.playerName.length < 12 && e.key.match(/[\x20-\x7E]/)) {
        this.playerName += e.key;
      }
      return;
    }

    if (this.state === "welcome" && (key === " " || key === "enter")) {
      this.state = "name_entry";
      this.playerName = "";
    } else if (this.state === "knob_tutorial") {
      if (this.tutorialPhase === "free" && (key === " " || key === "enter")) {
        this.advanceKnobTutorial();
      }
    } else if (this.state === "design" && (key === " " || key === "enter")) {
      this.startBuild();
    } else if (this.state === "built" && (key === " " || key === "enter")) {
      this.state = "play";
      this.sub = "seeding";
    } else if (this.state === "play") {
      if (this.sub === "inspect" && (key === " " || key === "enter")) {
        this.confirmSeed();
      } else if (this.sub === "result" && (key === " " || key === "enter")) {
        this.advancePost();
      } else if (this.sub === "inspect" && key === "escape") {
        this.seedNode = null;
        this.sub = "seeding";
      }
    } else if (this.state === "showboard" && (key === " " || key === "enter")) {
      this.state = "welcome";
      this.playerName = "";
      this.currentEntry = null;
    }
  }

  _handleMouseDown(e) {
    if (e.button === 0) {
      if (this.state === "play" && this.sub === "seeding") {
        this.inspectNode(e.offsetX, e.offsetY);
      } else if (this.state === "play" && this.sub === "inspect") {
        const clicked = this.nodeAt(e.offsetX, e.offsetY);
        if (clicked !== null && clicked !== this.seedNode) {
          this.inspectNode(e.offsetX, e.offsetY);
        } else if (clicked === this.seedNode) {
          this.confirmSeed();
        }
      }
    } else if (e.button === 2) {
      this.dragging = true;
      this.dragLast = [e.offsetX, e.offsetY];
    }
  }

  _handleMouseUp(e) {
    if (e.button === 2) this.dragging = false;
  }

  _handleMouseMove(e) {
    this.mouseX = e.offsetX;
    this.mouseY = e.offsetY;
    if (this.dragging) {
      this.pan[0] += e.offsetX - this.dragLast[0];
      this.pan[1] += e.offsetY - this.dragLast[1];
      this.dragLast = [e.offsetX, e.offsetY];
    }
  }

  _handleWheel(e) {
    e.preventDefault();
    const factor = Math.pow(1.15, -e.deltaY / 100);
    this.zoomAt(e.offsetX, e.offsetY, factor);
  }

  // --- Camera ---
  worldToScreen(x, y) {
    return [x * this.zoom + this.pan[0], y * this.zoom + this.pan[1]];
  }
  screenToWorld(sx, sy) {
    return [(sx - this.pan[0]) / this.zoom, (sy - this.pan[1]) / this.zoom];
  }
  zoomAt(mx, my, factor) {
    const [wx, wy] = this.screenToWorld(mx, my);
    this.zoom = Math.max(0.3, Math.min(6, this.zoom * factor));
    this.pan[0] = mx - wx * this.zoom;
    this.pan[1] = my - wy * this.zoom;
  }
  resetCamera() {
    this.zoom = 1;
    this.pan = [0, 0];
  }

  // --- State transitions ---
  startBuild() {
    this.graph = Network.generate(this.alpha, this.beta, this.delta,
      this.rng.randInt(0, 1 << 30));
    this.layoutState = Layout.createState(this.graph, W, H, this.rng.randInt(0, 1 << 30));
    this.graph.pos = [];
    for (let i = 0; i < this.graph.n; i++) {
      this.graph.pos.push([this.layoutState.posX[i], this.layoutState.posY[i]]);
    }
    const degs = this.graph.adj.map(a => a.length);
    this.nodeRadii = degs.map(d => nodeRadius(d, 35, 1, 10));
    this.buildItersTotal = 300;
    this.buildItersDone = 0;
    this.resetCamera();
    this.posts = drawPosts(this.rng);
    this.postIdx = 0;
    this.postResults = [];
    this.seedNode = null;
    this.state = "building";
  }

  startKnobTutorial() {
    this.state = "knob_tutorial";
    this.tutorialStep = 0;
    this.tutorialPhase = "animate";
    this.tutorialAnimT = 0;
    this.alpha = 0;
    this.beta = 0;
    this.delta = 0;
    this._prevKnobs = [this.alpha, this.beta, this.delta];
    this.regenPreview();
  }

  advanceKnobTutorial() {
    const knobAttr = TUTORIAL_STEPS[this.tutorialStep].knob;
    this[knobAttr] = 0.5;
    this.tutorialStep++;
    if (this.tutorialStep >= TUTORIAL_STEPS.length) {
      this.alpha = 0.5;
      this.beta = 0.5;
      this.delta = 0.5;
      this.state = "design";
      this._prevKnobs = [this.alpha, this.beta, this.delta];
      this.regenPreview();
    } else {
      this.tutorialPhase = "animate";
      this.tutorialAnimT = 0;
      const nextAttr = TUTORIAL_STEPS[this.tutorialStep].knob;
      this[nextAttr] = 0;
      this._prevKnobs = [this.alpha, this.beta, this.delta];
    }
  }

  finishGame() {
    const avgReach = this.postResults.reduce((s, r) => s + r.reachPct, 0) / this.postResults.length;
    const avgSat = this.postResults.reduce((s, r) => s + r.satisfactionPct, 0) / this.postResults.length;
    const entry = {
      name: this.playerName.trim(),
      reach: avgReach,
      satisfaction: avgSat,
      alpha: Math.round(this.alpha * 100) / 100,
      beta: Math.round(this.beta * 100) / 100,
      delta: Math.round(this.delta * 100) / 100,
    };
    this.currentEntry = entry;
    this.showboard.push(entry);
    saveShowboard(this.showboard);
    this.state = "showboard";
  }

  // --- Game logic ---
  nodeAt(mx, my) {
    if (!this.graph) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < this.graph.n; i++) {
      const [x, y] = this.graph.pos[i];
      const [sx, sy] = this.worldToScreen(x, y);
      const hit = Math.pow(this.nodeRadii[i] * this.zoom + 4, 2);
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd && d < hit) { bd = d; best = i; }
    }
    return best;
  }

  inspectNode(mx, my) {
    const i = this.nodeAt(mx, my);
    if (i === null) return;
    this.seedNode = i;
    this.sub = "inspect";
  }

  confirmSeed() {
    if (this.seedNode === null) return;
    const post = this.posts[this.postIdx];
    const { result, steps, activated } = Scoring.scorePostStable(
      this.graph, this.seedNode, post.topic, CONFIG.N, this.rng,
      this.alpha, this.beta
    );
    result.feedback = Scoring.feedbackText(result);
    this.cascadeSteps = steps;
    this.stableResult = result;
    this.stableActivated = activated;
    this.activatedSoFar = new Set();
    this.cascadeStepI = 0;
    this.cascadeTime = 0;
    this.sub = "cascade";
  }

  advancePost() {
    this.postResults.push(this.postResult);
    this.activatedSoFar = new Set();
    this.postIdx++;
    if (this.postIdx >= CONFIG.NUM_POSTS) {
      this.finishGame();
    } else {
      this.seedNode = null;
      this.sub = "seeding";
    }
  }

  // --- Preview ---
  regenPreview() {
    const a = this.alpha, b = this.beta, d = this.delta;
    const saved = {
      N: CONFIG.N, AVG_DEGREE: CONFIG.AVG_DEGREE, MAX_DEGREE: CONFIG.MAX_DEGREE,
      MIN_COMMUNITY_SIZE: CONFIG.MIN_COMMUNITY_SIZE, MAX_COMMUNITY_SIZE: CONFIG.MAX_COMMUNITY_SIZE,
    };
    CONFIG.N = 120;
    CONFIG.AVG_DEGREE = 9;
    CONFIG.MAX_DEGREE = Math.floor(12 + 68 * (1 - b));
    CONFIG.MIN_COMMUNITY_SIZE = 20;
    CONFIG.MAX_COMMUNITY_SIZE = 50;

    const g = Network.generate(a, b, d, this.rng.randInt(0, 1 << 30));

    Object.assign(CONFIG, saved);

    this.previewGraph = g;
    const ar = this.previewArea();
    const st = Layout.createState(g, ar.w, ar.h, 0);
    for (let i = 0; i < 300; i++) Layout.step(st, 300);
    Layout.fitToCanvas(st);
    g.pos = [];
    for (let i = 0; i < g.n; i++) g.pos.push([st.posX[i], st.posY[i]]);
    this.previewState = st;
    const degs = g.adj.map(a => a.length);
    this.previewRadii = degs.map(d => nodeRadius(d, 30, 1.5, 12));
    this.previewDegs = degs;
    this.previewParams = [a, b, d];
  }

  previewArea() {
    const px = sx(0.40);
    const py = sy(0.18);
    const pw = W - px - sp(40);
    const ph = H - py - sp(60);
    return { x: px, y: py, w: pw, h: ph };
  }

  maybeRegenPreview() {
    const knobs = [this.alpha, this.beta, this.delta];
    const prev = this._prevKnobs;
    if (knobs[0] !== prev[0] || knobs[1] !== prev[1] || knobs[2] !== prev[2]) {
      this._prevKnobs = [...knobs];
      this.knobsDirtySince = this.nowMs;
      return;
    }
    if (this.knobsDirtySince && this.nowMs - this.knobsDirtySince > 150) {
      if (!this.previewParams || this.previewParams[0] !== knobs[0] ||
          this.previewParams[1] !== knobs[1] || this.previewParams[2] !== knobs[2]) {
        this.regenPreview();
      }
      this.knobsDirtySince = 0;
    }
  }

  // --- Knob input ---
  handleKnobs(dt) {
    const step = CONFIG.KNOB_SPEED * dt;
    if (this.keysDown["q"]) this.alpha = Math.max(0, this.alpha - step);
    if (this.keysDown["a"]) this.alpha = Math.min(1, this.alpha + step);
    if (this.keysDown["w"]) this.beta = Math.max(0, this.beta - step);
    if (this.keysDown["s"]) this.beta = Math.min(1, this.beta + step);
    if (this.keysDown["e"]) this.delta = Math.max(0, this.delta - step);
    if (this.keysDown["d"]) this.delta = Math.min(1, this.delta + step);
  }

  handleTutorialKnob(dt) {
    const step = CONFIG.KNOB_SPEED * dt;
    const ts = TUTORIAL_STEPS[this.tutorialStep];
    const attr = ts.knob;
    if (this.keysDown[ts.keysUp]) this[attr] = Math.max(0, this[attr] - step);
    if (this.keysDown[ts.keysDown]) this[attr] = Math.min(1, this[attr] + step);
  }

  // --- Update ---
  update(dt, ms) {
    this.nowMs = performance.now();
    if (this.state === "knob_tutorial") {
      if (this.tutorialPhase === "animate") {
        this.tutorialAnimT += dt / CONFIG.TUTORIAL_ANIM_DURATION;
        if (this.tutorialAnimT >= 1) {
          this.tutorialAnimT = 1;
          this.tutorialPhase = "free";
        }
        this[TUTORIAL_STEPS[this.tutorialStep].knob] = Math.min(1, this.tutorialAnimT);
      } else {
        this.handleTutorialKnob(dt);
      }
      this.maybeRegenPreview();
    } else if (this.state === "design") {
      this.handleKnobs(dt);
      this.maybeRegenPreview();
    } else if (this.state === "building") {
      const itersPerFrame = 6;
      for (let i = 0; i < itersPerFrame; i++) {
        Layout.step(this.layoutState, this.buildItersTotal);
        this.buildItersDone++;
        for (let j = 0; j < this.graph.n; j++) {
          this.graph.pos[j] = [this.layoutState.posX[j], this.layoutState.posY[j]];
        }
        if (this.buildItersDone >= this.buildItersTotal) {
          Layout.fitToCanvas(this.layoutState);
          for (let j = 0; j < this.graph.n; j++) {
            this.graph.pos[j] = [this.layoutState.posX[j], this.layoutState.posY[j]];
          }
          this.state = "built";
          break;
        }
      }
    } else if (this.state === "play" && this.sub === "cascade") {
      this.cascadeTime += ms;
      while (this.cascadeStepI < this.cascadeSteps.length && this.cascadeTime >= CONFIG.CASCADE_STEP_MS) {
        this.cascadeTime -= CONFIG.CASCADE_STEP_MS;
        for (const v of this.cascadeSteps[this.cascadeStepI]) {
          this.activatedSoFar.add(v);
        }
        this.cascadeStepI++;
      }
      if (this.cascadeStepI >= this.cascadeSteps.length && this.cascadeTime > 300) {
        this.postResult = this.stableResult;
        this.sub = "result";
      }
    }
  }

  // --- Drawing ---
  draw() {
    ctx.fillStyle = CONFIG.BG;
    ctx.fillRect(0, 0, W, H);

    if (this.state === "welcome") this.drawWelcome();
    else if (this.state === "name_entry") this.drawNameEntry();
    else if (this.state === "knob_tutorial") this.drawKnobTutorial();
    else if (this.state === "design") this.drawDesign();
    else if (this.state === "building") this.drawNetwork("Building the network...");
    else if (this.state === "built") this.drawNetwork("Your platform is live. Press SPACE.");
    else if (this.state === "play") this.drawPlay();
    else if (this.state === "showboard") this.drawShowboard();
  }

  drawWelcome() {
    drawText("AlgoWorld", "L", CONFIG.ACCENT, W / 2, sy(0.29), true);
    drawText("Design a social-media platform. Then try to go viral on it.",
      "M", CONFIG.TEXT, W / 2, sy(0.36), true);
    drawText("You are the algorithm. What kind of feed do you create?",
      "S", CONFIG.MUTED, W / 2, sy(0.40), true);
    drawText("Press SPACE to start  \u00b7  F11 fullscreen",
      "M", CONFIG.TEXT, W / 2, sy(0.62), true);
  }

  drawNameEntry() {
    drawText("What's your name?", "L", CONFIG.ACCENT, W / 2, sy(0.35), true);
    drawText("You'll be placed on the Platform Map.", "S", CONFIG.MUTED, W / 2, sy(0.42), true);

    const bw = sp(300), bh = sp(50);
    const bx = W / 2 - bw / 2, by = sy(0.50);
    ctx.fillStyle = CONFIG.PANEL;
    roundRect(bx, by, bw, bh, sp(8));
    ctx.fill();
    ctx.strokeStyle = CONFIG.ACCENT;
    ctx.lineWidth = 2;
    roundRect(bx, by, bw, bh, sp(8));
    ctx.stroke();

    let display = this.playerName;
    if (Math.floor(this.nowMs / 500) % 2 === 0) display += "_";
    drawText(display, "M", CONFIG.TEXT, bx + sp(16), by + sp(12));
    drawText("Type your name (max 12 chars), then press ENTER",
      "S", CONFIG.MUTED, W / 2, by + bh + sp(30), true);
  }

  drawKnobTutorial() {
    const ts = TUTORIAL_STEPS[this.tutorialStep];
    drawText(`Algorithm Tutorial \u2014 Step ${this.tutorialStep + 1} of ${TUTORIAL_STEPS.length}`,
      "L", CONFIG.ACCENT, W / 2, sy(0.04), true);
    drawText(ts.title, "M", CONFIG.TEXT, W / 2, sy(0.09), true);
    drawWrappedCentered(ts.explain, "S", CONFIG.TEXT, W / 2, sy(0.13), sx(0.85));

    const knobsData = [
      ["Knob 1  (Q / A)", "Friends' Picks", "Similar Stuff", this.alpha],
      ["Knob 2  (W / S)", "Superstars", "Everyone Equal", this.beta],
      ["Knob 3  (E / D)", "Anything Goes", "Strict Rules", this.delta],
    ];
    const panelX = sp(40), panelW = sx(0.36), knobH = sp(120);
    const knobSpacing = Math.min(sp(140), Math.floor((H - sy(0.22) - sp(80)) / 3));

    for (let i = 0; i < knobsData.length; i++) {
      const [hdr, l, r, v] = knobsData[i];
      const y = sy(0.22) + i * knobSpacing;
      const isActive = i === this.tutorialStep;
      ctx.fillStyle = isActive ? CONFIG.PANEL : CONFIG.PANEL_DIM;
      roundRect(panelX, y, panelW, knobH, sp(8));
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = CONFIG.ACCENT;
        ctx.lineWidth = 2;
        roundRect(panelX, y, panelW, knobH, sp(8));
        ctx.stroke();
      }
      const accentCol = isActive ? CONFIG.ACCENT : "rgb(60,60,80)";
      drawText(hdr, "M", accentCol, panelX + sp(16), y + sp(10));

      const tx = panelX + sp(16), ty = y + knobH - sp(40), tw = panelW - sp(32);
      ctx.fillStyle = "rgb(60,60,80)";
      roundRect(tx, ty, tw, sp(8), sp(4));
      ctx.fill();
      const knobPx = tx + v * tw;
      ctx.beginPath();
      ctx.arc(knobPx, ty + sp(4), sp(10), 0, Math.PI * 2);
      ctx.fillStyle = accentCol;
      ctx.fill();
      drawText(l, "XS", CONFIG.MUTED, tx, ty + sp(16));
      const rw = measureText(r, "XS");
      drawText(r, "XS", CONFIG.MUTED, tx + tw - rw, ty + sp(16));
    }

    this.drawPreview(this.tutorialStep);

    if (this.tutorialStep === 1 && this.previewDegs.length) {
      const ar = this.previewArea();
      const degs = this.previewDegs;
      const superstars = degs.filter(d => d > 20).length;
      const maxDeg = Math.max(...degs);
      const statY = ar.y + ar.h - sp(60);
      ctx.fillStyle = "rgb(18,18,24)";
      roundRect(ar.x + sp(8), statY, sp(220), sp(55), sp(4));
      ctx.fill();
      drawText(`Superstars (deg>20): ${superstars}`, "S", CONFIG.ACCENT, ar.x + sp(14), statY + sp(6));
      drawText(`Biggest hub: ${maxDeg} connections`, "S", CONFIG.ACCENT, ar.x + sp(14), statY + sp(28));
    }

    if (this.tutorialPhase === "animate") {
      drawText("Watch the network change...", "M", CONFIG.MUTED, W / 2, H - sp(30), true);
    } else {
      drawText(ts.hint, "M", CONFIG.TEXT, W / 2, H - sp(30), true);
    }
  }

  drawDesign() {
    drawText("You are TikTok. You decide how the algorithm works.",
      "L", CONFIG.TEXT, W / 2, sy(0.07), true);
    drawText("Adjust the three dials. Watch your network change. SPACE to launch.",
      "S", CONFIG.MUTED, W / 2, sy(0.12), true);

    const knobs = [
      ["Knob 1  (Q / A)", "Friends' Picks", "Similar Stuff",
        "Network-based vs. content-based recommendations.", this.alpha],
      ["Knob 2  (W / S)", "Superstars", "Everyone Equal",
        "Flat visibility vs. hub-driven virality.", this.beta],
      ["Knob 3  (E / D)", "Anything Goes", "Strict Rules",
        "No moderation vs. pruning of controversial bridges.", this.delta],
    ];
    const panelX = sp(40), panelW = sx(0.36), knobH = sp(180);
    const knobSpacing = Math.min(
      Math.floor((H - sy(0.18) - sp(50) - knobH) / Math.max(1, knobs.length - 1)) + knobH,
      sp(210)
    );

    for (let i = 0; i < knobs.length; i++) {
      const [hdr, l, r, desc, v] = knobs[i];
      const y = sy(0.18) + i * knobSpacing;
      ctx.fillStyle = CONFIG.PANEL;
      roundRect(panelX, y, panelW, knobH, sp(8));
      ctx.fill();
      drawText(hdr, "M", CONFIG.ACCENT, panelX + sp(20), y + sp(12));
      drawText(desc, "S", CONFIG.MUTED, panelX + sp(20), y + sp(44));
      const tx = panelX + sp(20), ty = y + knobH - sp(60), tw = panelW - sp(40);
      ctx.fillStyle = "rgb(60,60,80)";
      roundRect(tx, ty, tw, sp(10), sp(5));
      ctx.fill();
      const knobPx = tx + v * tw;
      ctx.beginPath();
      ctx.arc(knobPx, ty + sp(5), sp(12), 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.ACCENT;
      ctx.fill();
      drawText(l, "XS", CONFIG.MUTED, tx, ty + sp(22));
      const rw = measureText(r, "XS");
      drawText(r, "XS", CONFIG.MUTED, tx + tw - rw, ty + sp(22));
      drawText(v.toFixed(2), "S", CONFIG.TEXT, tx + tw / 2, ty - sp(22), true);
    }

    this.drawPreview();
    drawText("SPACE  Launch your platform", "M", CONFIG.TEXT, W / 2, H - sp(30), true);
  }

  drawNetwork(title, showActivated, seedNodeOverride, inspectNode) {
    const g = this.graph;
    if (!g) return;
    const z = this.zoom;
    const [px, py] = this.pan;
    const s = sc();
    const degs = g.adj.map(a => a.length);
    const neighbors = inspectNode !== undefined && inspectNode !== null
      ? new Set(g.adj[inspectNode]) : new Set();

    // Edges
    for (let u = 0; u < g.n; u++) {
      for (const v of g.adj[u]) {
        if (v <= u) continue;
        const [x0, y0] = g.pos[u];
        const [x1, y1] = g.pos[v];
        const sx0 = x0 * z + px, sy0 = y0 * z + py;
        const sx1 = x1 * z + px, sy1 = y1 * z + py;

        let col, w;
        if (inspectNode !== undefined && inspectNode !== null && (u === inspectNode || v === inspectNode)) {
          col = "white";
          w = Math.max(2, edgeWidth(degs[u], degs[v], s * z) + 1);
        } else if (inspectNode !== undefined && inspectNode !== null) {
          col = "rgb(30,30,40)";
          w = 1;
        } else {
          col = "rgb(50,50,65)";
          w = edgeWidth(degs[u], degs[v], s * z);
        }
        ctx.beginPath();
        ctx.moveTo(sx0, sy0);
        ctx.lineTo(sx1, sy1);
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.stroke();
      }
    }

    // Nodes
    const radii = this.nodeRadii;
    for (let i = 0; i < g.n; i++) {
      const [x, y] = g.pos[i];
      let col = TOPICS[g.topic[i]].color;
      let r = radii[i] * z * s;
      let satRing = null;

      if (showActivated && this.activatedSoFar.has(i)) {
        const postTopic = this.posts[this.postIdx].topic;
        const a = AFFINITY[postTopic][g.topic[i]];
        satRing = affinityColor(a);
        r = (radii[i] + 2) * z * s;
      }

      if (inspectNode !== undefined && inspectNode !== null &&
          i !== inspectNode && !neighbors.has(i)) {
        const t = TOPICS[g.topic[i]].rgb;
        col = rgb(t[0] >> 2, t[1] >> 2, t[2] >> 2);
      }

      const scx = x * z + px, scy = y * z + py;
      const ri = Math.max(1, Math.round(r));

      if (satRing) {
        const ringR = ri + Math.max(2, Math.round(3 * z * s));
        ctx.beginPath();
        ctx.arc(scx, scy, ringR, 0, Math.PI * 2);
        ctx.fillStyle = satRing;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(scx, scy, ri, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }

    // Seed node highlight
    const sn = seedNodeOverride !== undefined ? seedNodeOverride : this.seedNode;
    if (sn !== null && sn !== undefined && g.pos[sn]) {
      const [x, y] = g.pos[sn];
      const scx = x * z + px, scy = y * z + py;
      ctx.beginPath();
      ctx.arc(scx, scy, sp(10) * z + 2, 0, Math.PI * 2);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (title) drawText(title, "M", CONFIG.TEXT, W / 2, sp(30), true);
    this.drawCommunityLegend();
    this.drawCameraHint();
  }

  drawCameraHint() {
    drawText("scroll: zoom \u00b7 right-drag: pan \u00b7 R: reset \u00b7 F11: fullscreen",
      "XS", CONFIG.MUTED, sp(12), H - sp(22));
  }

  drawCommunityLegend() {
    for (let i = 0; i < TOPICS.length; i++) {
      const y = sp(60) + i * sp(22);
      ctx.beginPath();
      ctx.arc(W - sp(170), y, Math.max(3, sp(6)), 0, Math.PI * 2);
      ctx.fillStyle = TOPICS[i].color;
      ctx.fill();
      drawText(TOPICS[i].name, "S", CONFIG.TEXT, W - sp(155), y - sp(11));
    }
  }

  drawPreview(tutorialStep) {
    const ar = this.previewArea();
    ctx.fillStyle = "rgb(24,24,32)";
    roundRect(ar.x, ar.y, ar.w, ar.h, sp(8));
    ctx.fill();
    ctx.strokeStyle = "rgb(60,60,80)";
    ctx.lineWidth = 1;
    roundRect(ar.x, ar.y, ar.w, ar.h, sp(8));
    ctx.stroke();

    if (!this.previewGraph) return;
    const g = this.previewGraph;
    const st = this.previewState;
    const pw = ar.w, ph = ar.h;
    const lw = st.width, lh = st.height;
    const sxR = lw ? pw / lw : 1;
    const syR = lh ? ph / lh : 1;
    const ratio = Math.min(sxR, syR);
    const ox = ar.x + (pw - lw * ratio) * 0.5;
    const oy = ar.y + (ph - lh * ratio) * 0.5;
    const s = sc();

    // Edges
    for (let u = 0; u < g.n; u++) {
      for (const v of g.adj[u]) {
        if (v <= u) continue;
        const cross = g.topic[u] !== g.topic[v];
        let col;
        if (tutorialStep === 0 && cross) col = CONFIG.TUTORIAL_HIGHLIGHT;
        else if (tutorialStep === 2 && cross) col = CONFIG.TUTORIAL_CUT;
        else col = "rgb(45,45,60)";
        const w = this.previewDegs.length ? edgeWidth(this.previewDegs[u], this.previewDegs[v], s) : 1;
        const x0 = ox + st.posX[u] * ratio, y0 = oy + st.posY[u] * ratio;
        const x1 = ox + st.posX[v] * ratio, y1 = oy + st.posY[v] * ratio;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.stroke();
      }
    }

    // Nodes
    for (let i = 0; i < g.n; i++) {
      const px = ox + st.posX[i] * ratio;
      const py = oy + st.posY[i] * ratio;
      const r = Math.max(1, Math.round(this.previewRadii[i] * s));
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = TOPICS[g.topic[i]].color;
      ctx.fill();
    }

    if (tutorialStep === undefined || tutorialStep === null) {
      drawText("Live preview \u2014 network regenerates as you turn the knobs",
        "XS", CONFIG.MUTED, ar.x + sp(10), ar.y - sp(20));
    }
  }

  drawPlay() {
    const post = this.posts[this.postIdx];
    const topic = TOPICS[post.topic];
    const inspect = this.sub === "inspect" ? this.seedNode : null;
    this.drawNetwork(null, true, this.seedNode, inspect);
    this.drawPostCard(post, topic);

    if (this.sub === "cascade") {
      drawText(`Reached: ${this.activatedSoFar.size} / ${CONFIG.N}`,
        "M", CONFIG.TEXT, W / 2, sp(60), true);
    }

    if (this.sub === "seeding") {
      drawText("Click a node to inspect it.", "M", CONFIG.ACCENT, W / 2, sp(60), true);
      const i = this.nodeAt(this.mouseX, this.mouseY);
      if (i !== null) {
        const tn = TOPICS[this.graph.topic[i]].name;
        drawText(`${tn} community`, "S", CONFIG.TEXT, this.mouseX + sp(12), this.mouseY - sp(22));
      }
    }

    if (this.sub === "inspect" && this.seedNode !== null) {
      drawText("SPACE / click again to post here  |  ESC to cancel  |  click another node to switch",
        "S", CONFIG.ACCENT, W / 2, sp(60), true);
      this.drawInspectOverlay();
    }

    if (this.sub === "result") this.drawResultOverlay();
  }

  drawPostCard(post, topic) {
    const x = sp(30), y = sp(120);
    const w = sx(0.24), h = sp(260);
    ctx.fillStyle = CONFIG.PANEL;
    roundRect(x, y, w, h, sp(10));
    ctx.fill();
    ctx.fillStyle = topic.color;
    roundRect(x, y, w, sp(8), sp(6));
    ctx.fill();

    drawText(`Post ${this.postIdx + 1} of ${CONFIG.NUM_POSTS}`, "S", CONFIG.MUTED, x + sp(16), y + sp(18));
    drawText(post.title, "M", CONFIG.TEXT, x + sp(16), y + sp(50));
    drawText(`#${topic.name}`, "S", topic.color, x + sp(16), y + sp(82));
    drawWrapped(post.desc, "S", CONFIG.TEXT, x + sp(16), y + sp(120), w - sp(32));

    const bc = BADGE_COLORS[post.kind];
    const label = BADGE_LABEL[post.kind];
    const bw = sp(160);
    const bx = x + w - bw - sp(16), by = y + h - sp(40);
    ctx.fillStyle = bc;
    roundRect(bx, by, bw, sp(26), sp(13));
    ctx.fill();
    drawText(label, "S", "rgb(10,10,20)", bx + bw / 2, by + sp(4), true);
  }

  drawInspectOverlay() {
    const i = this.seedNode;
    const g = this.graph;
    const deg = g.adj[i].length;
    const commName = TOPICS[g.topic[i]].name;
    const commCol = TOPICS[g.topic[i]].color;
    const commCounts = {};
    for (const nb of g.adj[i]) {
      const tn = TOPICS[g.topic[nb]].name;
      commCounts[tn] = (commCounts[tn] || 0) + 1;
    }

    const x = sp(30), y = sp(120) + sp(270);
    const w = sx(0.24);
    const entries = Object.entries(commCounts).sort((a, b) => b[1] - a[1]);
    const h = sp(30) + sp(24) * (2 + entries.length);

    ctx.fillStyle = CONFIG.PANEL;
    roundRect(x, y, w, h, sp(10));
    ctx.fill();
    ctx.fillStyle = commCol;
    roundRect(x, y, w, sp(6), sp(4));
    ctx.fill();

    drawText(`${commName} node \u2014 ${deg} connections`, "M", CONFIG.TEXT, x + sp(16), y + sp(14));
    let ty = y + sp(48);
    drawText("Connected to:", "S", CONFIG.MUTED, x + sp(16), ty);
    ty += sp(24);
    for (const [cn, cnt] of entries) {
      drawText(`  ${cn}: ${cnt}`, "S", CONFIG.TEXT, x + sp(16), ty);
      ty += sp(24);
    }
  }

  drawResultOverlay() {
    const r = this.postResult;
    const x = sp(30);
    const cardH = sp(260);
    let y = sp(120) + cardH + sp(20);
    const w = sx(0.24);
    const h = sp(260);
    if (y + h > H - sp(20)) y = H - sp(20) - h;

    ctx.fillStyle = CONFIG.PANEL;
    roundRect(x, y, w, h, sp(10));
    ctx.fill();

    drawText("Result", "M", CONFIG.ACCENT, x + sp(16), y + sp(14));
    drawText(`Reach: ${r.reach} / ${CONFIG.N}  (${r.reachPct.toFixed(1)}%)`,
      "S", CONFIG.TEXT, x + sp(16), y + sp(50));

    // Reach bar
    const bw = w - sp(32), barH = sp(10);
    ctx.fillStyle = "rgb(60,60,80)";
    roundRect(x + sp(16), y + sp(76), bw, barH, sp(5));
    ctx.fill();
    ctx.fillStyle = CONFIG.ACCENT;
    roundRect(x + sp(16), y + sp(76), Math.max(0, bw * r.reachPct / 100), barH, sp(5));
    ctx.fill();

    drawText(`Satisfaction: ${r.satisfactionPct.toFixed(0)}%`,
      "S", CONFIG.TEXT, x + sp(16), y + sp(100));

    ctx.fillStyle = "rgb(60,60,80)";
    roundRect(x + sp(16), y + sp(126), bw, barH, sp(5));
    ctx.fill();
    const sat = Math.max(0, Math.min(100, r.satisfactionPct));
    const col = sat >= 50 ? "rgb(90,210,110)" : sat >= 30 ? "rgb(230,220,90)" : "rgb(230,90,90)";
    ctx.fillStyle = col;
    roundRect(x + sp(16), y + sp(126), Math.max(0, bw * sat / 100), barH, sp(5));
    ctx.fill();

    drawText(`Communities reached: ${r.communitiesHit}`, "S", CONFIG.MUTED, x + sp(16), y + sp(150));
    drawWrapped(r.feedback, "S", CONFIG.MUTED, x + sp(16), y + sp(188), w - sp(32));

    const cue = this.postIdx < CONFIG.NUM_POSTS - 1 ? "SPACE  Next post" : "SPACE  See results";
    drawText(cue, "S", CONFIG.ACCENT, x + w / 2, y + h - sp(22), true);
  }

  // --- Showboard ---
  drawShowboard() {
    drawText("The Platform Map", "L", CONFIG.ACCENT, W / 2, sy(0.04), true);
    drawText("Where does your platform land?", "S", CONFIG.MUTED, W / 2, sy(0.08), true);

    // Post summary cards
    const cardX = sp(30), cardW = sx(0.22), cardH = sp(70), cardGap = sp(8);
    const cardsY = sy(0.13);
    for (let i = 0; i < this.postResults.length; i++) {
      const r = this.postResults[i];
      const p = this.posts[i];
      const topic = TOPICS[p.topic];
      const cy = cardsY + i * (cardH + cardGap);
      ctx.fillStyle = CONFIG.PANEL;
      roundRect(cardX, cy, cardW, cardH, sp(6));
      ctx.fill();
      ctx.fillStyle = topic.color;
      roundRect(cardX, cy, cardW, sp(4), sp(4));
      ctx.fill();
      drawText(`${BADGE_LABEL[p.kind]}: ${p.title}`, "S", CONFIG.TEXT, cardX + sp(10), cy + sp(10));
      drawText(`Reach ${r.reachPct.toFixed(0)}%   Satisfaction ${r.satisfactionPct.toFixed(0)}%`,
        "XS", CONFIG.MUTED, cardX + sp(10), cy + sp(38));
    }

    // Scatter plot
    const plotML = sx(0.28), plotMR = sp(40), plotMT = sy(0.13), plotMB = sp(80);
    const plotX = plotML, plotY = plotMT;
    const plotW = W - plotML - plotMR, plotH = H - plotMT - plotMB;
    this.drawScatter(plotX, plotY, plotW, plotH);

    if (this.currentEntry) {
      const e = this.currentEntry;
      let qkey;
      if (e.satisfaction >= 60) {
        qkey = e.reach >= 30 ? "top_right" : "top_left";
      } else {
        qkey = e.reach >= 30 ? "bot_right" : "bot_left";
      }
      drawText(QUADRANT_LABELS[qkey][1], "S", CONFIG.MUTED, W / 2, H - sp(55), true);
    }

    drawText("SPACE  Play again", "M", CONFIG.TEXT, W / 2, H - sp(30), true);
  }

  drawScatter(px, py, pw, ph) {
    ctx.fillStyle = "rgb(24,24,32)";
    roundRect(px, py, pw, ph, sp(8));
    ctx.fill();

    const cx = px + 0.30 * pw;
    const cy = py + ph - 0.60 * ph;

    ctx.strokeStyle = "rgb(50,50,65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, py); ctx.lineTo(cx, py + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, cy); ctx.lineTo(px + pw, cy);
    ctx.stroke();

    drawText("Reach %", "S", CONFIG.MUTED, px + pw / 2, py + ph + sp(8), true);
    drawText("Satisfaction %", "S", CONFIG.MUTED, px + sp(4), py - sp(18));
    drawText("0", "XS", CONFIG.MUTED, px + sp(4), py + ph + sp(4));
    drawText("100", "XS", CONFIG.MUTED, px + pw - sp(24), py + ph + sp(4));
    drawText("0", "XS", CONFIG.MUTED, px - sp(20), py + ph - sp(10));
    drawText("100", "XS", CONFIG.MUTED, px - sp(30), py + sp(2));

    const leftCx = px + 0.15 * pw;
    const rightCx = px + 0.65 * pw;
    const topCy = py + 0.20 * ph;
    const botCy = py + ph - 0.20 * ph;
    const quads = [
      ["top_right", rightCx, topCy],
      ["top_left", leftCx, topCy],
      ["bot_right", rightCx, botCy],
      ["bot_left", leftCx, botCy],
    ];
    for (const [qkey, qx, qy] of quads) {
      drawText(QUADRANT_LABELS[qkey][0], "S", "rgb(80,80,100)", qx, qy - sp(10), true);
    }

    // Other entries
    for (const entry of this.showboard) {
      if (entry === this.currentEntry) continue;
      const ex = px + entry.reach / 100 * pw;
      const ey = py + ph - entry.satisfaction / 100 * ph;
      ctx.beginPath();
      ctx.arc(ex, ey, sp(5), 0, Math.PI * 2);
      ctx.fillStyle = "rgb(80,80,110)";
      ctx.fill();
      drawText(entry.name, "XS", "rgb(100,100,120)", ex + sp(5) + sp(4), ey - sp(6));
    }

    // Current entry
    if (this.currentEntry) {
      const e = this.currentEntry;
      const ex = px + e.reach / 100 * pw;
      const ey = py + ph - e.satisfaction / 100 * ph;
      ctx.beginPath();
      ctx.arc(ex, ey, sp(8) + sp(6), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120,200,255,0.24)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, sp(8), 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.ACCENT;
      ctx.fill();
      drawText(e.name, "M", CONFIG.ACCENT, ex + sp(8) + sp(6), ey - sp(10));
    }
  }

  // --- Main loop ---
  _loop(now) {
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    const ms = now - this._lastTime;
    this._lastTime = now;
    this.update(dt, ms);
    this.draw();
    requestAnimationFrame((t) => this._loop(t));
  }
}

// Start the game
window.addEventListener("load", () => {
  new Game();
});

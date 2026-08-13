import type { InfoBoard, PlayerMove, PublicPlayer, PublicWorld, Status } from "../shared/protocol";
import { clampMove, inBox, solidsOf, type World } from "../shared/world";

export type WorldPerson = PublicPlayer & {
  walkT: number;
  ix: number;
  iy: number;
  tx?: number;
  ty?: number;
};

export type WorldHandlers = {
  onMove?: (pos: { x: number; y: number; facing: 1 | -1; moving: boolean }) => void;
  onSit?: (deskId: number) => void;
  onStand?: () => void;
  onClickPerson?: (id: string) => void;
  onBarIce?: () => void;
};

type TouchDir = "up" | "down" | "left" | "right";

const SPEED = 220;
export const STATUS_COLOR: Record<Status, string> = {
  kennismaken: "#22c55e",
  studeren: "#3b82f6",
  pauze: "#f59e0b",
};

const state = {
  world: null as World | null,
  canvas: null as HTMLCanvasElement | null,
  ctx: null as CanvasRenderingContext2D | null,
  viewport: null as HTMLElement | null,
  layer: null as HTMLElement | null,
  avatarsEl: null as HTMLElement | null,
  cache: null as HTMLCanvasElement | null,
  meId: null as string | null,
  players: new Map<string, WorldPerson>(),
  nodes: new Map<string, HTMLElement>(),
  keys: {} as Record<string, boolean>,
  touch: { up: false, down: false, left: false, right: false },
  camX: 0,
  camY: 0,
  viewW: 0,
  viewH: 0,
  target: null as { x: number; y: number } | null,
  lastSend: 0,
  lastTs: 0,
  lastPos: { x: 0, y: 0, moving: false },
  handlers: {} as WorldHandlers,
  mounted: false,
  board: null as InfoBoard | null,
  tableIces: new Map<string, string>(),
  minimap: null as HTMLCanvasElement | null,
};

export function mount(opts: {
  canvas: HTMLCanvasElement;
  viewport: HTMLElement;
  layer: HTMLElement;
  avatarsEl: HTMLElement;
  handlers: WorldHandlers;
  minimap?: HTMLCanvasElement;
}) {
  state.canvas = opts.canvas;
  state.ctx = opts.canvas.getContext("2d");
  state.viewport = opts.viewport;
  state.layer = opts.layer;
  state.avatarsEl = opts.avatarsEl;
  state.handlers = opts.handlers;
  state.minimap = opts.minimap || null;
  resize();
  if (!state.mounted) {
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    state.canvas.addEventListener("click", onClick);
    state.minimap?.addEventListener("click", onMinimapClick);
    state.mounted = true;
    loop(performance.now());
  }
}

export function setBoard(board: InfoBoard) {
  state.board = board;
  if (state.world) state.world.board = board;
}

export function setTableIce(id: string, ice: string | null) {
  if (ice) state.tableIces.set(id, ice);
  else state.tableIces.delete(id);
}

export function replaceTableIces(ices: { id: string; ice: string }[]) {
  state.tableIces.clear();
  for (const item of ices) state.tableIces.set(item.id, item.ice);
}

export function walkTo(x: number, y: number) {
  const self = me();
  if (self?.sittingTableId) return;
  if (self?.sittingDeskId) {
    state.handlers.onStand?.();
    self.sittingDeskId = null;
  }
  state.target = { x, y };
}

export function deskOf(id: number) {
  return state.world?.desks.find((d) => d.id === id) || null;
}

export function setWorld(world: PublicWorld) {
  state.world = { ...world, solids: solidsOf(world) };
  state.board = world.board;
  state.cache = null;
  if (state.layer) {
    state.layer.style.width = `${world.width}px`;
    state.layer.style.height = `${world.height}px`;
  }
}

export function setMe(id: string) {
  state.meId = id;
}

export function upsert(player: PublicPlayer) {
  const prev = state.players.get(player.id);
  const merged: WorldPerson = {
    walkT: prev?.walkT || 0,
    ix: player.x ?? prev?.ix ?? player.x,
    iy: player.y ?? prev?.iy ?? player.y,
    ...prev,
    ...player,
  };
  if (player.x != null) {
    merged.tx = player.x;
    merged.ty = player.y;
  }
  state.players.set(player.id, merged);
  ensureNode(merged);
}

export function remove(id: string) {
  state.players.delete(id);
  state.nodes.get(id)?.remove();
  state.nodes.delete(id);
}

export function applyMoves(moves: PlayerMove[]) {
  for (const m of moves) {
    const p = state.players.get(m.id);
    if (!p || m.id === state.meId) continue;
    p.tx = m.x;
    p.ty = m.y;
    p.facing = m.facing;
    p.moving = m.moving;
    p.sittingDeskId = m.sittingDeskId;
    p.sittingTableId = m.sittingTableId;
  }
}

export function me() {
  return (state.meId && state.players.get(state.meId)) || null;
}

export function setTouch(dir: TouchDir, down: boolean) {
  state.touch[dir] = down;
}

function resize() {
  if (!state.viewport || !state.canvas || !state.ctx) return;
  state.viewW = state.viewport.clientWidth;
  state.viewH = state.viewport.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.canvas.width = state.viewW * dpr;
  state.canvas.height = state.viewH * dpr;
  state.canvas.style.width = `${state.viewW}px`;
  state.canvas.style.height = `${state.viewH}px`;
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.cache = null;
}

function shouldIgnoreKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
}

function onKey(e: KeyboardEvent) {
  if (shouldIgnoreKey(e)) return;
  state.keys[e.key.toLowerCase()] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) e.preventDefault();
}

function onKeyUp(e: KeyboardEvent) {
  state.keys[e.key.toLowerCase()] = false;
}

function onClick(e: MouseEvent) {
  const worldPt = screenToWorld(e.clientX, e.clientY);
  const person = hitPerson(worldPt.x, worldPt.y);
  if (person && person.id !== state.meId) {
    state.handlers.onClickPerson?.(person.id);
    return;
  }
  const self = me();
  if (self?.sittingTableId) return;
  const bar = state.world?.zones.find((z) => z.id === "bar");
  const cafeAisle = state.world?.zones.find((z) => z.id === "cafe");
  if ((cafeAisle && inBox(cafeAisle, worldPt.x, worldPt.y)) || (bar && inBox(bar, worldPt.x, worldPt.y))) {
    state.handlers.onBarIce?.();
  }
  const desk = hitDesk(worldPt.x, worldPt.y);
  if (desk) {
    state.handlers.onSit?.(desk.id);
    state.target = null;
    return;
  }
  if (self?.sittingDeskId) state.handlers.onStand?.();
  state.target = worldPt;
}

function onMinimapClick(e: MouseEvent) {
  const w = state.world;
  const mm = state.minimap;
  if (!w || !mm) return;
  const rect = mm.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * w.width;
  const y = ((e.clientY - rect.top) / rect.height) * w.height;
  walkTo(x, y);
}

function screenToWorld(clientX: number, clientY: number) {
  const rect = state.canvas!.getBoundingClientRect();
  return { x: clientX - rect.left + state.camX, y: clientY - rect.top + state.camY };
}

function hitPerson(x: number, y: number) {
  let best: WorldPerson | null = null;
  let bestD = 40;
  for (const p of state.players.values()) {
    const d = Math.hypot(x - p.x, y - (p.y - 40));
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function hitDesk(x: number, y: number) {
  return state.world?.desks.find((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h + 40) || null;
}

function loop(ts: number) {
  requestAnimationFrame(loop);
  if (!state.world) return;
  const dt = Math.min(0.05, (ts - (state.lastTs || ts)) / 1000);
  state.lastTs = ts;
  update(dt);
  draw();
  syncDom();
}

function wantedDir() {
  let dx = 0;
  let dy = 0;
  if (state.keys.a || state.keys.arrowleft || state.touch.left) dx -= 1;
  if (state.keys.d || state.keys.arrowright || state.touch.right) dx += 1;
  if (state.keys.w || state.keys.arrowup || state.touch.up) dy -= 1;
  if (state.keys.s || state.keys.arrowdown || state.touch.down) dy += 1;
  return { dx, dy };
}

function tryMove(self: WorldPerson, dx: number, dy: number) {
  const world = state.world;
  if (!world) return;
  const next = clampMove(world, self.x, self.y, self.x + dx, self.y + dy);
  self.x = next.x;
  self.y = next.y;
}

function update(dt: number) {
  const self = me();
  const world = state.world;
  if (!self || !world) return;
  const dir = wantedDir();
  let moving = false;
  if (self.sittingTableId) {
    self.moving = false;
  } else if (self.sittingDeskId && (dir.dx || dir.dy)) {
    state.handlers.onStand?.();
    self.sittingDeskId = null;
  }
  if (!self.sittingDeskId && !self.sittingTableId) {
    if (dir.dx || dir.dy) {
      const len = Math.hypot(dir.dx, dir.dy) || 1;
      tryMove(self, (dir.dx / len) * SPEED * dt, (dir.dy / len) * SPEED * dt);
      self.facing = dir.dx < 0 ? -1 : dir.dx > 0 ? 1 : self.facing;
      moving = true;
      state.target = null;
    } else if (state.target) {
      const tdx = state.target.x - self.x;
      const tdy = state.target.y - self.y;
      const dist = Math.hypot(tdx, tdy);
      if (dist > 6) {
        tryMove(self, (tdx / dist) * SPEED * dt, (tdy / dist) * SPEED * 0.9 * dt);
        self.facing = tdx < 0 ? -1 : 1;
        moving = true;
      } else state.target = null;
    }
  }
  self.moving = moving;
  self.ix = self.x;
  self.iy = self.y;
  if (moving) self.walkT += dt * 10;

  for (const p of state.players.values()) {
    if (p.id === state.meId || p.tx == null || p.ty == null) continue;
    p.ix = p.ix == null ? p.x : p.ix;
    p.iy = p.iy == null ? p.y : p.iy;
    p.ix += (p.tx - p.ix) * Math.min(1, dt * 12);
    p.iy += (p.ty - p.iy) * Math.min(1, dt * 12);
    p.x = p.ix;
    p.y = p.iy;
    if (p.moving) p.walkT += dt * 10;
  }

  const now = performance.now();
  if (now - state.lastSend > 50) {
    const changed =
      Math.abs(self.x - state.lastPos.x) > 1 ||
      Math.abs(self.y - state.lastPos.y) > 1 ||
      self.moving !== state.lastPos.moving;
    if (changed) {
      state.handlers.onMove?.({ x: self.x, y: self.y, facing: self.facing, moving: self.moving });
      state.lastPos = { x: self.x, y: self.y, moving: self.moving };
    }
    state.lastSend = now;
  }

  state.camX += (self.x - state.viewW / 2 - state.camX) * 0.12;
  state.camY += (self.y - state.viewH / 2 - state.camY) * 0.12;
  state.camX = Math.max(0, Math.min(world.width - state.viewW, state.camX));
  state.camY = Math.max(0, Math.min(world.height - state.viewH, state.camY));
  if (world.width < state.viewW) state.camX = (world.width - state.viewW) / 2;
  if (world.height < state.viewH) state.camY = (world.height - state.viewH) / 2;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawStatic(ctx: CanvasRenderingContext2D, w: PublicWorld) {
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, w.width, w.height);
  for (let y = 80; y < w.height; y += 28) {
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(0, y, w.width, 2);
  }
  const stripe = ctx.createLinearGradient(0, 0, 0, 220);
  stripe.addColorStop(0, "#FFE600");
  stripe.addColorStop(1, "rgba(255,230,0,0)");
  ctx.fillStyle = stripe;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, 0, w.width, 220);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w.width, 0);
  ctx.lineTo(w.width, 90);
  ctx.lineTo(w.width / 2, 30);
  ctx.lineTo(0, 90);
  ctx.closePath();
  ctx.fill();

  const zone = (id: string) => w.zones.find((z) => z.id === id);
  const bar = zone("bar");
  const stage = zone("stage");
  const info = zone("info");
  const lounge = zone("lounge");
  const speed = zone("speeddate");

  if (bar) {
    roundRect(ctx, bar.x + 10, bar.y + 10, bar.w - 20, bar.h - 20, 16, "#111");
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 28px Geist, sans-serif";
    ctx.fillText("Koffie & fris", bar.x + 40, bar.y + 58);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "500 16px Geist, sans-serif";
    ctx.fillText("Even rechtstaan? Haal een kop en kom praten.", bar.x + 40, bar.y + 88);
  }

  if (stage) {
    roundRect(ctx, stage.x, stage.y, stage.w, stage.h, 18, "#000");
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 42px Bebas Neue, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PKP26  ·  CLUB  ·  PUKKELBLOK", stage.x + stage.w / 2, stage.y + 58);
    ctx.font = "600 18px Geist, sans-serif";
    ctx.fillText("100 bureaus  ·  20–23 AUG  ·  Kiewit", stage.x + stage.w / 2, stage.y + 96);
    ctx.textAlign = "left";
  }

  if (info) {
    roundRect(ctx, info.x + 10, info.y + 10, info.w - 20, info.h - 20, 16, "#111");
  }

  if (lounge) {
    roundRect(ctx, lounge.x, lounge.y, lounge.w, lounge.h, 20, "#111");
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 20px Geist, sans-serif";
    ctx.fillText("Lounge", lounge.x + 22, lounge.y + 40);
    for (const corner of w.schoolCorners) {
      roundRect(ctx, corner.x, corner.y, corner.w, corner.h, 14, "#1a1a1a");
      ctx.fillStyle = "#FFE600";
      ctx.font = "800 22px Geist, sans-serif";
      ctx.fillText(corner.label, corner.x + 18, corner.y + 48);
      ctx.fillStyle = "#888";
      ctx.font = "500 13px Geist, sans-serif";
      ctx.fillText("herkenningshoek", corner.x + 18, corner.y + 72);
    }
    ctx.fillStyle = "#2a2a2a";
    for (const circle of w.talkCircles) {
      ctx.beginPath();
      ctx.ellipse(circle.x, circle.y, 70, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFE600";
      ctx.font = "700 13px Geist, sans-serif";
      ctx.fillText(circle.label, circle.x - 28, circle.y + 4);
      ctx.fillStyle = "#2a2a2a";
    }
  }

  for (const d of w.desks) {
    roundRect(ctx, d.x, d.y, d.w, d.h, 10, "#2a2a2a");
    roundRect(ctx, d.x + 10, d.y + 10, d.w - 20, 32, 6, "#0a0a0a");
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 15px Geist, sans-serif";
    ctx.fillText(d.label, d.x + 16, d.y + 66);
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.ellipse(d.seatX, d.seatY + 6, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (speed) {
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 22px Geist, sans-serif";
    ctx.fillText("Speeddate-hoek", speed.x + 20, speed.y + 28);
  }
  for (const t of w.speedTables) {
    roundRect(ctx, t.x, t.y, t.w, t.h, 12, "#1a1a1a");
    ctx.fillStyle = "#fff";
    ctx.font = "700 16px Geist, sans-serif";
    ctx.fillText(t.label, t.x + 16, t.y + 54);
  }

  ctx.strokeStyle = "rgba(255,230,0,.35)";
  ctx.lineWidth = 8;
  ctx.strokeRect(24, 24, w.width - 48, w.height - 48);
}

function ensureCache() {
  const w = state.world;
  if (!w) return;
  if (state.cache && state.cache.width === w.width) return;
  const c = document.createElement("canvas");
  c.width = w.width;
  c.height = w.height;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  drawStatic(ctx, w);
  state.cache = c;
}

function draw() {
  const ctx = state.ctx;
  const w = state.world;
  if (!ctx || !w || !state.layer) return;
  ctx.clearRect(0, 0, state.viewW, state.viewH);
  ctx.save();
  ctx.translate(-state.camX, -state.camY);
  ensureCache();
  if (state.cache) ctx.drawImage(state.cache, 0, 0);
  const t = Date.now() / 400;
  for (let i = 0; i < 18; i++) {
    const x = 80 + (i * (w.width - 160)) / 17;
    const y = 58 + Math.sin(t + i) * 4;
    ctx.fillStyle = i % 2 ? "#FFE600" : "#ffffff";
    ctx.globalAlpha = 0.55 + Math.sin(t * 1.4 + i) * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawLive(ctx, w);
  ctx.restore();
  state.layer.style.transform = `translate(${-state.camX}px, ${-state.camY}px)`;
  drawMinimap();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, cy);
}

function drawLive(ctx: CanvasRenderingContext2D, w: PublicWorld) {
  const board = state.board || w.board;
  const info = w.zones.find((z) => z.id === "info");
  if (info && board) {
    ctx.fillStyle = "#FFE600";
    ctx.font = "800 22px Geist, sans-serif";
    ctx.fillText(board.moment || board.title, info.x + 40, info.y + 58);
    ctx.fillStyle = "#ddd";
    ctx.font = "500 15px Geist, sans-serif";
    ctx.fillText(board.subtitle, info.x + 40, info.y + 88);
  }

  for (const circle of w.talkCircles) {
    let n = 0;
    for (const p of state.players.values()) if (p.talkCircleId === circle.id) n += 1;
    ctx.strokeStyle = n ? "rgba(255,230,0,.7)" : "rgba(255,230,0,.22)";
    ctx.lineWidth = n ? 4 : 2;
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const t of w.speedTables) {
    const ice = state.tableIces.get(t.id);
    if (!ice) continue;
    ctx.fillStyle = "#FFE600";
    ctx.font = "700 14px Geist, sans-serif";
    wrapText(ctx, ice, t.x + 8, t.y - 12, t.w - 12, 16);
  }
}

function drawMinimap() {
  const mm = state.minimap;
  const w = state.world;
  const self = me();
  if (!mm || !w) return;
  const ctx = mm.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = mm.clientWidth || 200;
  const cssH = mm.clientHeight || 155;
  if (mm.width !== cssW * dpr || mm.height !== cssH * dpr) {
    mm.width = cssW * dpr;
    mm.height = cssH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const sx = cssW / w.width;
  const sy = cssH / w.height;
  ctx.save();
  ctx.scale(sx, sy);
  if (state.cache) ctx.drawImage(state.cache, 0, 0);
  else {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, w.width, w.height);
  }
  for (const p of state.players.values()) {
    ctx.fillStyle = p.id === state.meId ? "#FFE600" : "#888";
    ctx.beginPath();
    ctx.arc(p.ix ?? p.x, p.iy ?? p.y, p.id === state.meId ? 28 : 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (self) {
    ctx.strokeStyle = "rgba(255,230,0,.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(state.camX * sx, state.camY * sy, state.viewW * sx, state.viewH * sy);
  }
}

function ensureNode(p: WorldPerson) {
  let el = state.nodes.get(p.id);
  if (el) return el;
  el = document.createElement("div");
  el.className = "person" + (p.id === state.meId ? " me" : "");
  el.innerHTML = `
    <div class="bubble"></div>
    <div class="body">
      <div class="legs"><span class="leg l"></span><span class="leg r"></span></div>
      <div class="torso"></div>
      <img class="face" alt=""/>
      <span class="st-dot"></span>
    </div>
    <div class="nametag"></div>`;
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (p.id !== state.meId) state.handlers.onClickPerson?.(p.id);
  });
  state.avatarsEl?.appendChild(el);
  state.nodes.set(p.id, el);
  return el;
}

function syncDom() {
  for (const p of state.players.values()) {
    const el = ensureNode(p);
    const x = p.ix ?? p.x;
    const y = p.iy ?? p.y;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.zIndex = String(100 + Math.floor(y));
    el.classList.toggle("walking", Boolean(p.moving) && !p.sittingDeskId);
    el.classList.toggle("sitting", Boolean(p.sittingDeskId || p.sittingTableId));
    el.classList.toggle("face-left", p.facing === -1);
    (el.querySelector(".torso") as HTMLElement).style.background = p.color || "#FFE600";
    const img = el.querySelector(".face") as HTMLImageElement;
    if (img.getAttribute("src") !== p.avatarUrl) img.src = p.avatarUrl;
    el.querySelector(".nametag")!.textContent = p.firstName;
    (el.querySelector(".st-dot") as HTMLElement).style.background = STATUS_COLOR[p.status] || "#22c55e";
    const bubble = el.querySelector(".bubble")!;
    if (p.typing && p.draft) {
      bubble.textContent = p.draft;
      bubble.className = "bubble on typing";
    } else if (p.waving) {
      bubble.textContent = p.waving;
      bubble.className = "bubble on wave";
    } else if (p.bubble) {
      bubble.textContent = p.bubble;
      bubble.className = "bubble on";
    } else {
      bubble.className = "bubble";
    }
    const self = me();
    if (self && p.id !== self.id) {
      const dist = Math.hypot((p.ix ?? p.x) - self.x, (p.iy ?? p.y) - self.y);
      const range = state.world?.proximity || 420;
      el.style.opacity = dist > range ? "0.42" : "1";
      if (dist > range) bubble.className = "bubble";
    } else {
      el.style.opacity = "1";
    }
  }
}

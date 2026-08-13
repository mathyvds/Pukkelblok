import type { InfoBoard, PlayerMove, PublicPlayer, PublicWorld, Status } from "../shared/protocol";
import { clampMove, inTableBubble, inZone, nearestStudyTable, solidsOf, studyTableById, type World } from "../shared/world";
import { drawHomeNest, drawStaticTent, drawStringLights, drawTableBubble, drawWarmSpots } from "./tent-art";

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
  onSitSpot?: (spotId: string) => void;
  onJoinTable?: (tableId: string) => void;
  onLeaveTable?: () => void;
  onStand?: () => void;
  onPrompt?: (prompt: TablePrompt | null) => void;
  onClickPerson?: (id: string) => void;
  onBarIce?: () => void;
};

type TouchDir = "up" | "down" | "left" | "right";

export type TablePrompt = {
  action: "join" | "leave";
  tableId: string;
  label: string;
  seated: number;
  max: number;
};

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
  followId: null as string | null,
  lastSend: 0,
  lastTs: 0,
  lastPos: { x: 0, y: 0, moving: false },
  handlers: {} as WorldHandlers,
  mounted: false,
  minimap: null as HTMLCanvasElement | null,
  board: null as InfoBoard | null,
  prompt: null as TablePrompt | null,
};

export function mount(opts: {
  canvas: HTMLCanvasElement;
  viewport: HTMLElement;
  layer: HTMLElement;
  avatarsEl: HTMLElement;
  minimap?: HTMLCanvasElement;
  handlers: WorldHandlers;
}) {
  state.canvas = opts.canvas;
  state.ctx = opts.canvas.getContext("2d");
  state.viewport = opts.viewport;
  state.layer = opts.layer;
  state.avatarsEl = opts.avatarsEl;
  state.handlers = opts.handlers;
  if (opts.minimap) {
    state.minimap = opts.minimap;
    if (!opts.minimap.dataset.bound) {
      opts.minimap.dataset.bound = "1";
      opts.minimap.addEventListener("click", onMinimapClick);
    }
  }
  resize();
  if (!state.mounted) {
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    state.canvas.addEventListener("click", onClick);
    state.mounted = true;
    void document.fonts?.ready?.then(() => {
      state.cache = null;
    });
    loop(performance.now());
  }
}

export function setBoard(board: InfoBoard) {
  state.board = board;
  if (state.world) state.world.board = board;
  state.cache = null;
}

export function setWorld(world: PublicWorld) {
  state.world = { ...world, solids: solidsOf(world) };
  if (world.board) state.board = world.board;
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
    p.sittingSpotId = m.sittingSpotId ?? p.sittingSpotId ?? null;
    if (m.tableId !== undefined) p.tableId = m.tableId;
  }
}

function me() {
  return (state.meId && state.players.get(state.meId)) || null;
}

export function isNearby(id: string, range?: number) {
  const self = me();
  const p = state.players.get(id);
  if (!self || !p) return false;
  if (p.id === self.id) return true;
  const mine = myBubbleId();
  if (mine) {
    if (self.inDate) return p.dateTableId === self.dateTableId;
    if (self.talkCircleId) return p.talkCircleId === self.talkCircleId;
    return p.tableId === mine && inTableBubble(p.status, p.sittingDeskId);
  }
  const dist = Math.hypot((p.ix ?? p.x) - self.x, (p.iy ?? p.y) - self.y);
  return dist <= (range || state.world?.proximity || 420);
}

export function walkTo(x: number, y: number) {
  const self = me();
  if (!self || self.inDate) return;
  if (self.sittingDeskId || self.sittingSpotId) {
    state.handlers.onStand?.();
    self.sittingDeskId = null;
    self.sittingSpotId = null;
  }
  state.followId = null;
  state.target = { x, y };
}

export function walkToPlayer(id: string) {
  const self = me();
  const other = state.players.get(id);
  if (!self || !other || self.inDate) return;
  if (self.sittingDeskId || self.sittingSpotId) {
    state.handlers.onStand?.();
    self.sittingDeskId = null;
    self.sittingSpotId = null;
  }
  state.followId = id;
  retargetFollow();
}

function retargetFollow() {
  const self = me();
  const p = state.followId ? state.players.get(state.followId) : null;
  if (!self || !p) {
    state.followId = null;
    return;
  }
  const px = p.ix ?? p.x;
  const py = p.iy ?? p.y;
  const dx = px - self.x;
  const dy = py - self.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 72) {
    state.followId = null;
    state.target = null;
    return;
  }
  state.target = { x: px - (dx / dist) * 62, y: py - (dy / dist) * 62 };
}

export function myPlaceHint() {
  const self = me();
  const w = state.world;
  if (!self || !w) return "";
  if (self.inDate) return "Je zit aan een speeddate-tafel";
  if (self.status === "studeren") return `Stilte · jouw bureau ${self.homeDeskId}`;
  if (self.sittingSpotId?.startsWith("stool")) return "Koffiehoek · je zit aan de bar";
  if (self.sittingSpotId?.startsWith("lounge")) return "Lounge · je zit op de bank";
  if (self.talkCircleId) return "Lounge · praatcirkel — geen timer";
  if (inTableBubble(self.status, self.sittingDeskId)) {
    const table = studyTableById(w, self.tableId);
    return table ? `${table.label} · bubbel — alleen zij horen je` : "Tafelbubbel";
  }
  if (inZone(w, self.x, self.y, "coffee")) return "Koffiehoek · hier mag je praten";
  if (inZone(w, self.x, self.y, "lounge")) return "Lounge · schuif aan bij een cirkel";
  if (inZone(w, self.x, self.y, "speeddate")) return "Speeddate-hoek";
  if (self.sittingDeskId) return `Je zit aan bureau ${self.sittingDeskId}`;
  if (self.homeDeskId) return `Jouw bureau: ${self.homeDeskId}`;
  return "";
}

export function myBubbleId() {
  const self = me();
  if (!self) return null;
  if (self.inDate) return self.dateTableId;
  if (self.talkCircleId) return self.talkCircleId;
  if (inTableBubble(self.status, self.sittingDeskId)) return self.tableId;
  return null;
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
  if (e.key.toLowerCase() === "e" && !e.repeat) {
    e.preventDefault();
    actOnPrompt();
  }
}

function actOnPrompt() {
  const prompt = currentPrompt();
  if (!prompt) return;
  if (prompt.action === "leave") state.handlers.onLeaveTable?.();
  else state.handlers.onJoinTable?.(prompt.tableId);
}

export function confirmTablePrompt() {
  actOnPrompt();
}

function onKeyUp(e: KeyboardEvent) {
  state.keys[e.key.toLowerCase()] = false;
}

function onClick(e: MouseEvent) {
  const self = me();
  if (self?.inDate) return;
  const worldPt = screenToWorld(e.clientX, e.clientY);
  const person = hitPerson(worldPt.x, worldPt.y);
  if (person && person.id !== state.meId) {
    state.handlers.onClickPerson?.(person.id);
    return;
  }
  const desk = hitDesk(worldPt.x, worldPt.y);
  if (desk) {
    state.handlers.onSit?.(desk.id);
    state.target = null;
    state.followId = null;
    return;
  }
  const table = hitTable(worldPt.x, worldPt.y);
  if (table) {
    const selfNow = me();
    if (selfNow && inTableBubble(selfNow.status, selfNow.sittingDeskId) && selfNow.tableId === table.id) {
      state.handlers.onLeaveTable?.();
    } else {
      state.handlers.onJoinTable?.(table.id);
    }
    state.target = null;
    state.followId = null;
    return;
  }
  if (state.world && inZone(state.world, worldPt.x, worldPt.y, "bar")) {
    state.handlers.onBarIce?.();
    return;
  }
  const seat = hitSeat(worldPt.x, worldPt.y);
  if (seat) {
    state.handlers.onSitSpot?.(seat.id);
    state.target = null;
    state.followId = null;
    return;
  }
  if (self?.sittingDeskId || self?.sittingSpotId) state.handlers.onStand?.();
  state.followId = null;
  state.target = worldPt;
}

function onMinimapClick(e: MouseEvent) {
  const w = state.world;
  const canvas = state.minimap;
  if (!w || !canvas) return;
  const rect = canvas.getBoundingClientRect();
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
  return (
    state.world?.desks.find((d) => {
      const dx = Math.abs(x - d.seatX);
      const dy = Math.abs(y - d.seatY);
      return dx <= 32 && dy <= 28;
    }) || null
  );
}

function hitTable(x: number, y: number) {
  return (
    state.world?.tables?.find(
      (t) => x >= t.x - 8 && x <= t.x + t.w + 8 && y >= t.y - 8 && y <= t.y + t.h + 8
    ) || null
  );
}

function takenSpots() {
  const taken = new Set<string>();
  for (const p of state.players.values()) {
    if (p.sittingSpotId) taken.add(p.sittingSpotId);
  }
  return taken;
}

function nearestOpenSeat(x: number, y: number, kind?: "stool" | "lounge") {
  const world = state.world;
  if (!world) return null;
  const taken = takenSpots();
  let best = null as (typeof world.seats)[number] | null;
  let bestD = 140;
  for (const seat of world.seats) {
    if (kind && seat.kind !== kind) continue;
    if (taken.has(seat.id) && seat.id !== me()?.sittingSpotId) continue;
    const d = Math.hypot(x - seat.seatX, y - seat.seatY);
    if (d < bestD) {
      best = seat;
      bestD = d;
    }
  }
  return best;
}

function hitSeat(x: number, y: number) {
  const world = state.world;
  if (!world) return null;
  const direct = world.seats.find((s) => {
    const padTop = s.kind === "lounge" ? 90 : 8;
    return x >= s.x - 8 && x <= s.x + s.w + 8 && y >= s.y - padTop && y <= s.y + s.h + 36;
  });
  if (direct) return direct;
  const bar = world.zones.find((z) => z.id === "bar");
  if (bar && x >= bar.x && x <= bar.x + bar.w && y >= bar.y && y <= bar.y + 120) {
    return nearestOpenSeat(x, y, "stool");
  }
  return null;
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
  if (state.followId) retargetFollow();
  const dir = wantedDir();
  let moving = false;
  if (self.inDate) {
    self.moving = false;
    state.target = null;
    state.followId = null;
  } else {
    if ((self.sittingDeskId || self.sittingSpotId) && (dir.dx || dir.dy)) {
      state.handlers.onStand?.();
      self.sittingDeskId = null;
      self.sittingSpotId = null;
    }
    if (!self.sittingDeskId && !self.sittingSpotId) {
      if (dir.dx || dir.dy) {
        const len = Math.hypot(dir.dx, dir.dy) || 1;
        tryMove(self, (dir.dx / len) * SPEED * dt, (dir.dy / len) * SPEED * dt);
        self.facing = dir.dx < 0 ? -1 : dir.dx > 0 ? 1 : self.facing;
        moving = true;
        state.target = null;
        state.followId = null;
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
  }
  self.moving = moving;
  self.ix = self.x;
  self.iy = self.y;
  if (moving) self.walkT += dt * 10;
  refreshPrompt();

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

function drawStatic(ctx: CanvasRenderingContext2D, w: PublicWorld) {
  drawStaticTent(ctx, w);
}

function ensureCache() {
  const w = state.world;
  if (!w) return;
  if (state.cache && state.cache.width === w.width && state.cache.height === w.height) return;
  const c = document.createElement("canvas");
  c.width = w.width;
  c.height = w.height;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  drawStatic(ctx, w);
  state.cache = c;
}

function tableSeatedCount(tableId: string) {
  let n = 0;
  for (const p of state.players.values()) {
    if (p.tableId === tableId && inTableBubble(p.status, p.sittingDeskId)) n += 1;
  }
  return n;
}

function currentPrompt(): TablePrompt | null {
  const self = me();
  const w = state.world;
  if (!self || !w || self.inDate || self.status === "studeren") return null;
  if (inTableBubble(self.status, self.sittingDeskId) && self.tableId) {
    const table = studyTableById(w, self.tableId);
    if (!table) return null;
    return {
      action: "leave",
      tableId: table.id,
      label: table.label,
      seated: tableSeatedCount(table.id),
      max: table.deskIds.length,
    };
  }
  const near = nearestStudyTable(w, self.x, self.y, 118);
  if (!near) return null;
  return {
    action: "join",
    tableId: near.id,
    label: near.label,
    seated: tableSeatedCount(near.id),
    max: near.deskIds.length,
  };
}

function refreshPrompt() {
  const next = currentPrompt();
  const prev = state.prompt;
  const same =
    (next && prev && next.action === prev.action && next.tableId === prev.tableId && next.seated === prev.seated) ||
    (!next && !prev);
  if (same) return;
  state.prompt = next;
  state.handlers.onPrompt?.(next);
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
  drawWarmSpots(ctx, w, t);
  drawStringLights(ctx, w, t);
  const self = me();
  const bubbleId = myBubbleId();
  for (const table of w.tables || []) {
    const n = tableSeatedCount(table.id);
    drawTableBubble(ctx, table, Boolean(n) || bubbleId === table.id);
  }
  if (self?.homeDeskId) {
    const home = w.desks.find((d) => d.id === self.homeDeskId);
    if (home) drawHomeNest(ctx, home, self.deskStyle);
  }
  ctx.globalAlpha = 1;
  for (const circle of w.talkCircles || []) {
    const n = [...state.players.values()].filter((p) => p.talkCircleId === circle.id).length;
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.fillStyle = n ? "rgba(196, 91, 122, 0.16)" : "rgba(212, 188, 58, 0.07)";
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = n ? "rgba(212, 188, 58, 0.55)" : "rgba(232, 176, 96, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e8d5a8";
    ctx.font = "700 13px Geist, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(n ? `Cirkel  ${n}/${circle.max}` : "Schuif aan", circle.x, circle.y - 8);
    ctx.textAlign = "left";
  }
  for (const corner of w.schoolCorners || []) {
    ctx.fillStyle = "rgba(233, 30, 140, 0.12)";
    ctx.fillRect(corner.x, corner.y, corner.w, corner.h);
    ctx.fillStyle = "#ffe6a8";
    ctx.font = "800 16px Geist, sans-serif";
    ctx.fillText(corner.label, corner.x + 14, corner.y + 28);
    ctx.font = "600 11px Geist, sans-serif";
    ctx.fillStyle = "#c8b48a";
    ctx.fillText("herkenningshoek", corner.x + 14, corner.y + 46);
  }
  const board = state.board || w.board;
  const info = w.zones.find((z) => z.id === "info");
  if (board && info) {
    ctx.fillStyle = "#111";
    ctx.font = "800 18px Geist, sans-serif";
    ctx.fillText(board.moment || board.title, info.x + 40, info.y + 58);
    ctx.font = "600 13px Geist, sans-serif";
    ctx.fillStyle = "#3a2e22";
    ctx.fillText(board.subtitle, info.x + 40, info.y + 88);
  }
  ctx.restore();
  state.layer.style.transform = `translate(${-state.camX}px, ${-state.camY}px)`;
  paintMinimap();
}

function paintMinimap() {
  const canvas = state.minimap;
  const w = state.world;
  if (!canvas || !w) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const sx = cw / w.width;
  const sy = ch / w.height;
  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, cw, ch);
  const fillZone = (id: string, color: string) => {
    const z = w.zones.find((zone) => zone.id === id);
    if (!z) return;
    ctx.fillStyle = color;
    ctx.fillRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
  };
  fillZone("study", "rgba(59,130,246,0.22)");
  fillZone("coffee", "rgba(255,180,40,0.34)");
  fillZone("lounge", "rgba(233,30,140,0.22)");
  fillZone("speeddate", "rgba(255,230,0,0.16)");
  ctx.fillStyle = "rgba(212,188,58,0.28)";
  for (const table of w.tables || []) {
    ctx.fillRect(table.x * sx, table.y * sy, table.w * sx, table.h * sy);
  }
  ctx.strokeStyle = "rgba(255,230,0,0.35)";
  ctx.lineWidth = 1;
  for (const c of w.talkCircles) {
    ctx.beginPath();
    ctx.arc(c.x * sx, c.y * sy, Math.max(3, c.r * sx), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.strokeRect(state.camX * sx, state.camY * sy, state.viewW * sx, state.viewH * sy);
  for (const p of state.players.values()) {
    const mine = p.id === state.meId;
    ctx.fillStyle = mine ? "#FFE600" : STATUS_COLOR[p.status] || "#fff";
    ctx.beginPath();
    ctx.arc((p.ix ?? p.x) * sx, (p.iy ?? p.y) * sy, mine ? 3.6 : 2.3, 0, Math.PI * 2);
    ctx.fill();
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
      <span class="shh" hidden>stil</span>
    </div>
    <div class="nametag"><span class="nm"></span><span class="nm-extra"></span></div>`;
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
    const seated = Boolean(p.sittingDeskId) || Boolean(p.sittingSpotId) || Boolean(p.inDate);
    el.classList.toggle("walking", Boolean(p.moving) && !seated);
    el.classList.toggle("sitting", seated);
    el.classList.toggle("face-left", p.facing === -1);
    el.classList.toggle("silent", p.status === "studeren");
    el.classList.toggle("dnd", p.status === "studeren");
    el.classList.toggle("in-circle", Boolean(p.talkCircleId));
    el.classList.toggle("bot", Boolean(p.isBot));
    el.classList.toggle("in-bubble", Boolean(p.tableId) && inTableBubble(p.status, p.sittingDeskId));
    (el.querySelector(".torso") as HTMLElement).style.background = p.color || "#FFE600";
    const img = el.querySelector(".face") as HTMLImageElement;
    if (img.getAttribute("src") !== p.avatarUrl) img.src = p.avatarUrl;
    const silent = p.status === "studeren";
    const nm = el.querySelector(".nm");
    if (nm) nm.textContent = p.firstName;
    const extra =
      silent
        ? p.statusText
          ? `${p.statusText} · Niet storen`
          : "Niet storen"
        : p.statusText || "";
    const extraEl = el.querySelector(".nm-extra");
    if (extraEl) extraEl.textContent = extra;
    el.classList.toggle("has-extra", Boolean(extra));
    (el.querySelector(".st-dot") as HTMLElement).style.background = STATUS_COLOR[p.status] || "#22c55e";
    const shh = el.querySelector(".shh") as HTMLElement | null;
    if (shh) shh.hidden = !silent;
    const bubble = el.querySelector(".bubble")!;
    const self = me();
    const hideTalk = silent || self?.status === "studeren";
    if (!hideTalk && p.waving) {
      bubble.textContent = p.waving;
      bubble.className = "bubble on wave";
    } else if (!hideTalk && p.typing) {
      bubble.textContent = "…";
      bubble.className = "bubble on typing";
    } else if (!hideTalk && p.bubble) {
      bubble.textContent = p.bubble;
      bubble.className = "bubble on";
    } else {
      bubble.className = "bubble";
    }
    if (self && p.id !== self.id) {
      const bubbleId = myBubbleId();
      const dist = Math.hypot((p.ix ?? p.x) - self.x, (p.iy ?? p.y) - self.y);
      const range = state.world?.proximity || 420;
      const mate =
        bubbleId &&
        ((self.inDate && p.dateTableId === self.dateTableId) ||
          (self.talkCircleId && p.talkCircleId === self.talkCircleId) ||
          (p.tableId === bubbleId && inTableBubble(p.status, p.sittingDeskId)));
      if (bubbleId && !mate) {
        el.style.opacity = "0.18";
        el.classList.add("faded");
        bubble.className = "bubble";
      } else {
        el.classList.remove("faded");
        el.style.opacity = silent ? "0.78" : dist > range ? "0.42" : "1";
        if (dist > range && !mate) bubble.className = "bubble";
      }
    } else {
      el.classList.remove("faded");
      el.style.opacity = "1";
    }
  }
  refreshPrompt();
}

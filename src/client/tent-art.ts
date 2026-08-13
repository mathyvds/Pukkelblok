import type { Desk, PublicWorld, Seat, Zone } from "../shared/protocol";

const YELLOW = "#d4bc3a";
const YELLOW_LIT = "#ffe66a";
const PINK = "#c45b7a";
const PINK_LIT = "#e08aa6";
const WOOD = "#6b4a2c";
const WOOD_DARK = "#3d2a18";
const WOOD_PALE = "#a67c52";
const CANVAS = "#c4b496";
const CANVAS_FOLD = "#8d7c5e";
const INK = "#1c1612";

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function zone(w: PublicWorld, id: string): Zone | undefined {
  return w.zones.find((z) => z.id === id);
}

function drawGrass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#152016";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(40, 28, 16, 0.45)";
  for (let i = 0; i < 80; i++) {
    const x = hash(i * 3.1) * w;
    const y = hash(i * 7.7) * h;
    ctx.fillRect(x, y, 18 + hash(i) * 40, 3);
  }
}

function drawDeck(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const inset = 48;
  const deckW = w - inset * 2;
  const deckH = h - 88;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(inset, 72, deckW, deckH, 18);
  ctx.clip();
  const plankH = 40;
  let row = 0;
  for (let y = 72; y < h; y += plankH) {
    let x = inset - (row % 2) * 70;
    let col = 0;
    while (x < w - inset + 80) {
      const plankW = 150 + hash(row * 17 + col) * 90;
      const shade = 0.55 + hash(row * 9 + col * 4) * 0.45;
      const r = Math.floor(78 + shade * 42);
      const g = Math.floor(50 + shade * 28);
      const b = Math.floor(28 + shade * 14);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, plankW - 2, plankH - 1);
      ctx.fillStyle = `rgba(30,18,10,${0.12 + hash(col + row) * 0.12})`;
      ctx.fillRect(x + 8, y + 6, plankW - 18, 1);
      ctx.fillStyle = "rgba(20,12,8,0.55)";
      ctx.fillRect(x + 16, y + plankH - 8, 3, 3);
      ctx.fillRect(x + plankW - 22, y + 7, 3, 3);
      x += plankW;
      col += 1;
    }
    row += 1;
  }
  ctx.fillStyle = "rgba(18,10,6,0.32)";
  ctx.fillRect(inset, 72, deckW, deckH);
  ctx.restore();
  ctx.strokeStyle = "rgba(42, 30, 18, 0.7)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.roundRect(inset, 72, deckW, deckH, 18);
  ctx.stroke();
}

function drawCanvasFolds(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: boolean
) {
  ctx.fillStyle = CANVAS;
  ctx.fillRect(x, y, w, h);
  const count = vertical ? Math.ceil(w / 46) : Math.ceil(h / 42);
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const dark = 0.08 + hash(i + x + y) * 0.18;
    ctx.fillStyle = `rgba(70, 54, 36, ${dark})`;
    if (vertical) {
      const px = x + i * (w / count);
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.quadraticCurveTo(px + 10, y + h * 0.5, px + 4, y + h);
      ctx.lineTo(px + 18, y + h);
      ctx.quadraticCurveTo(px + 22, y + h * 0.5, px + 16, y);
      ctx.closePath();
      ctx.fill();
    } else {
      const py = y + i * (h / count);
      ctx.fillRect(x, py, w, 8 + hash(i) * 10);
    }
  }
  ctx.fillStyle = "rgba(212, 188, 58, 0.08)";
  ctx.fillRect(x, y, w, 6);
  ctx.fillStyle = "rgba(196, 91, 122, 0.07)";
  ctx.fillRect(x, y + 6, w, 4);
}

function drawTentShell(ctx: CanvasRenderingContext2D, world: PublicWorld) {
  const { width: w, height: h } = world;
  drawCanvasFolds(ctx, 0, 0, 56, h, true);
  drawCanvasFolds(ctx, w - 56, 0, 56, h, true);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, 108);
  ctx.lineTo(w / 2, 22);
  ctx.lineTo(0, 108);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, 108);
  ctx.lineTo(w / 2, 22);
  ctx.lineTo(0, 108);
  ctx.closePath();
  ctx.clip();
  drawCanvasFolds(ctx, 0, 0, w, 120, false);
  const ridge = ctx.createLinearGradient(0, 0, 0, 90);
  ridge.addColorStop(0, "rgba(28, 22, 16, 0.55)");
  ridge.addColorStop(1, "rgba(28, 22, 16, 0)");
  ctx.fillStyle = ridge;
  ctx.fillRect(0, 0, w, 90);
  ctx.restore();
  ctx.strokeStyle = "rgba(40, 28, 16, 0.55)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 108);
  ctx.lineTo(w / 2, 22);
  ctx.lineTo(w, 108);
  ctx.stroke();
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(w / 2 - 6, 18, 12, 96);
}

function drawRolledFence(ctx: CanvasRenderingContext2D, x: number, y: number, len: number) {
  roundRect(ctx, x, y, len, 22, 11, "#4a4a48");
  const stripeW = 18;
  for (let i = 0; i < len / stripeW; i++) {
    ctx.fillStyle = i % 2 ? YELLOW : PINK;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + 8 + i * stripeW, y + 4, 10, 14);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#6a6a66";
  ctx.beginPath();
  ctx.arc(x + 8, y + 11, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a2a28";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + 8, y + 11, 7, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) {
  roundRect(ctx, x, y, w, h, 4, WOOD);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 8);
  ctx.lineTo(x + w - 8, y + h - 8);
  ctx.moveTo(x + w - 8, y + 8);
  ctx.lineTo(x + 8, y + h - 8);
  ctx.stroke();
  ctx.fillStyle = YELLOW;
  ctx.globalAlpha = 0.7;
  ctx.font = "700 11px Geist, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w / 2, y + h / 2 + 4);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function drawEspresso(ctx: CanvasRenderingContext2D, x: number, y: number) {
  roundRect(ctx, x, y, 86, 64, 6, "#2a2420");
  roundRect(ctx, x + 10, y - 18, 36, 22, 4, "#1a1614");
  ctx.fillStyle = "#3a3430";
  ctx.fillRect(x + 22, y + 20, 14, 18);
  ctx.fillStyle = "#c9b496";
  ctx.beginPath();
  ctx.ellipse(x + 48, y + 52, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 70, y + 12);
  ctx.quadraticCurveTo(x + 92, y + 8, x + 88, y + 36);
  ctx.stroke();
  ctx.fillStyle = PINK;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(x + 8, y + 8, 18, 6);
  ctx.globalAlpha = 1;
}

function drawBar(ctx: CanvasRenderingContext2D, bar: Zone, stools: Seat[]) {
  roundRect(ctx, bar.x + 8, bar.y + 4, bar.w - 16, 92, 12, WOOD_DARK);
  roundRect(ctx, bar.x + 16, bar.y + 10, bar.w - 32, 28, 6, "#5a4330");
  ctx.fillStyle = "rgba(232, 176, 96, 0.18)";
  ctx.fillRect(bar.x + 20, bar.y + 12, bar.w - 40, 8);
  drawEspresso(ctx, bar.x + 40, bar.y + 38);
  roundRect(ctx, bar.x + 150, bar.y + 36, 70, 48, 6, "#2a221c");
  ctx.fillStyle = "#e8d5a8";
  ctx.font = "700 13px Geist, sans-serif";
  ctx.fillText("Koffie", bar.x + 162, bar.y + 58);
  ctx.font = "500 11px Geist, sans-serif";
  ctx.fillStyle = YELLOW;
  ctx.fillText("fris · thee", bar.x + 162, bar.y + 74);
  ctx.fillStyle = "#d8c4a0";
  ctx.font = "600 12px Geist, sans-serif";
  ctx.fillText("Machine is al warm. Crew zet nog kopjes klaar.", bar.x + 240, bar.y + 58);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? "#f2e6d0" : "#2a2420";
    ctx.beginPath();
    ctx.ellipse(bar.x + 560 + i * 28, bar.y + 70, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of stools) {
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(s.x + 18, s.y + 8, 8, 28);
    ctx.beginPath();
    ctx.ellipse(s.x + 22, s.y + 10, 18, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#5a4030";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.x + 22, s.y + 8, 16, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8a6244";
    ctx.fill();
  }
}

function drawStage(ctx: CanvasRenderingContext2D, stage: Zone) {
  roundRect(ctx, stage.x, stage.y + 48, stage.w, stage.h - 36, 8, "#2a221c");
  ctx.fillStyle = WOOD;
  ctx.fillRect(stage.x + 10, stage.y + stage.h - 18, stage.w - 20, 14);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(stage.x + 40, stage.y + 8, stage.w - 80, 52);
  ctx.fillStyle = YELLOW;
  ctx.globalAlpha = 0.85;
  ctx.font = "800 64px Bebas Neue, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CLUB", stage.x + stage.w / 2, stage.y + 54);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = PINK;
  ctx.font = "600 16px Geist, sans-serif";
  ctx.fillText("Pukkelblok  ·  dag vóór PKP  ·  Kiewit", stage.x + stage.w / 2, stage.y + 78);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#c9b496";
  ctx.font = "500 13px Geist, sans-serif";
  ctx.fillText("Podium nog leeg. Morgen gaat het los — vanavond is van de blok.", stage.x + stage.w / 2, stage.y + 118);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#6a6a66";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(stage.x + 90, stage.y + stage.h - 8, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(stage.x + 90, stage.y + stage.h - 24);
  ctx.lineTo(stage.x + 90, stage.y + 92);
  ctx.lineTo(stage.x + 118, stage.y + 80);
  ctx.stroke();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.ellipse(stage.x + 126, stage.y + 78, 8, 5, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a3a38";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(stage.x + 160, stage.y + stage.h - 10);
  ctx.bezierCurveTo(stage.x + 200, stage.y + stage.h + 10, stage.x + 240, stage.y + stage.h - 30, stage.x + 280, stage.y + stage.h - 8);
  ctx.stroke();
}

function drawProgram(ctx: CanvasRenderingContext2D, info: Zone) {
  roundRect(ctx, info.x + 18, info.y + 8, info.w - 36, info.h - 16, 8, "#3a2e22");
  roundRect(ctx, info.x + 32, info.y + 18, info.w - 64, info.h - 36, 4, "#f3ead2");
  ctx.fillStyle = INK;
  ctx.font = "800 18px Geist, sans-serif";
  ctx.fillText("Dagprogramma  ·  Club-tent", info.x + 52, info.y + 48);
  ctx.fillStyle = PINK;
  ctx.font = "600 12px Geist, sans-serif";
  ctx.fillText("Tent staat. Festival start morgen.", info.x + 52, info.y + 68);
  const lines = [
    ["14:00", "Backstage — crew only"],
    ["15:00", "Frietkraam warmt op (weidekant)"],
    ["later", "Verrassingsoptreden — als het stil blijft"],
    ["16:30", "Speeddate in de hoek, 3 min."],
  ];
  lines.forEach((line, i) => {
    const y = info.y + 84 + i * 18;
    ctx.fillStyle = i === 3 ? PINK : WOOD_DARK;
    ctx.font = "800 13px Geist, sans-serif";
    ctx.fillText(line[0], info.x + 52, y);
    ctx.fillStyle = "#3a3228";
    ctx.font = "500 13px Geist, sans-serif";
    ctx.fillText(line[1], info.x + 118, y);
  });
}

function drawLounge(ctx: CanvasRenderingContext2D, lounge: Zone, world: PublicWorld) {
  ctx.fillStyle = "rgba(28, 18, 16, 0.28)";
  ctx.fillRect(lounge.x + 6, lounge.y + 8, lounge.w - 12, lounge.h - 16);
  ctx.fillStyle = PINK;
  ctx.globalAlpha = 0.7;
  ctx.font = "800 16px Geist, sans-serif";
  ctx.fillText("Lounge", lounge.x + 22, lounge.y + 36);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8d5a8";
  ctx.font = "500 12px Geist, sans-serif";
  ctx.fillText("Zit op de bank. Schuif aan. Geen timer.", lounge.x + 22, lounge.y + 56);
  for (const s of world.seats.filter((seat) => seat.kind === "lounge")) {
    roundRect(ctx, s.x, s.y, s.w, s.h + 10, 12, "#4a3028");
    roundRect(ctx, s.x + 8, s.y + 6, s.w - 16, 22, 8, "#8a5850");
  }
}

function drawDesk(ctx: CanvasRenderingContext2D, d: Desk) {
  roundRect(ctx, d.x, d.y, d.w, d.h, 8, "#5a3e2a");
  roundRect(ctx, d.x + 8, d.y + 8, d.w - 16, 28, 4, "#2a1e16");
  ctx.fillStyle = "rgba(232, 176, 96, 0.08)";
  ctx.fillRect(d.x + 10, d.y + 10, d.w - 20, 6);
  roundRect(ctx, d.x + d.w - 34, d.y + d.h - 24, 26, 16, 3, "#3a2a18");
  ctx.fillStyle = "#e8d5a8";
  ctx.font = "700 12px Geist, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(d.label, d.x + d.w - 21, d.y + d.h - 12);
  ctx.textAlign = "left";
  ctx.fillStyle = "#2a1e16";
  ctx.beginPath();
  ctx.ellipse(d.seatX, d.seatY + 4, 18, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a3428";
  ctx.beginPath();
  ctx.ellipse(d.seatX, d.seatY, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpeedCorner(ctx: CanvasRenderingContext2D, world: PublicWorld) {
  const speed = zone(world, "speeddate");
  if (speed) {
    ctx.fillStyle = YELLOW;
    ctx.globalAlpha = 0.8;
    ctx.font = "800 16px Geist, sans-serif";
    ctx.fillText("Speeddate  16:30", speed.x + 16, speed.y + 28);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#e8d5a8";
    ctx.font = "500 12px Geist, sans-serif";
    ctx.fillText("Tafeltjes staan al. Nog stil.", speed.x + 16, speed.y + 48);
  }
  for (const t of world.speedTables) {
    ctx.fillStyle = WOOD_DARK;
    ctx.beginPath();
    ctx.ellipse(t.x + t.w / 2, t.y + t.h / 2 + 8, 18, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(t.x + t.w / 2 - 6, t.y + 20, 12, 36);
    ctx.beginPath();
    ctx.ellipse(t.x + t.w / 2, t.y + 22, t.w / 2 - 8, 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = WOOD_PALE;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "700 13px Geist, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t.label, t.x + t.w / 2, t.y + 26);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 230, 106, 0.25)";
    ctx.beginPath();
    ctx.arc(t.x + t.w / 2, t.y + 10, 6, 0, Math.PI * 2);
    ctx.fill();
    if (t.seatAx) {
      ctx.fillStyle = "#2a1e16";
      ctx.beginPath();
      ctx.ellipse(t.seatAx, t.seatAy + 4, 16, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(t.seatBx, t.seatBy + 4, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCables(ctx: CanvasRenderingContext2D, world: PublicWorld) {
  ctx.strokeStyle = "rgba(20, 14, 10, 0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, 58);
  for (let i = 1; i <= 24; i++) {
    const x = 70 + (i * (world.width - 140)) / 24;
    ctx.quadraticCurveTo(x - 30, 58 + (i % 2 ? 14 : -4), x, 58 + Math.sin(i) * 6);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(90, 112);
  for (let i = 1; i <= 18; i++) {
    const x = 90 + (i * (world.width - 180)) / 18;
    ctx.quadraticCurveTo(x - 24, 112 + (i % 2 ? 10 : -6), x, 118);
  }
  ctx.stroke();
}

export function drawStaticTent(ctx: CanvasRenderingContext2D, world: PublicWorld) {
  drawGrass(ctx, world.width, world.height);
  drawDeck(ctx, world.width, world.height);
  drawTentShell(ctx, world);
  const bar = zone(world, "bar");
  const coffee = zone(world, "coffee");
  const stage = zone(world, "stage");
  const info = zone(world, "info");
  const lounge = zone(world, "lounge");
  const study = zone(world, "study");
  const stools = (world.seats || []).filter((s) => s.kind === "stool");
  if (study) {
    ctx.fillStyle = "rgba(40, 32, 24, 0.12)";
    ctx.fillRect(study.x, study.y, study.w, study.h);
    ctx.fillStyle = "#c9b496";
    ctx.font = "700 14px Geist, sans-serif";
    ctx.fillText("Stilte  ·  blokzone", study.x + 24, study.y + 28);
  }
  if (coffee) {
    ctx.fillStyle = "rgba(232, 176, 96, 0.08)";
    ctx.fillRect(coffee.x + 8, coffee.y + 8, coffee.w - 16, coffee.h - 16);
    ctx.fillStyle = "#e8d5a8";
    ctx.font = "600 13px Geist, sans-serif";
    ctx.fillText("Koffiehoek · hier mag je praten", coffee.x + 28, coffee.y + coffee.h - 18);
  }
  if (bar) drawBar(ctx, bar, stools);
  if (stage) drawStage(ctx, stage);
  if (info) drawProgram(ctx, info);
  if (lounge) drawLounge(ctx, lounge, world);
  for (const d of world.desks) drawDesk(ctx, d);
  drawSpeedCorner(ctx, world);
  drawCrate(ctx, 92, 2268, 78, 54, "CREW");
  drawCrate(ctx, 186, 2284, 58, 42, "PKP");
  drawCrate(ctx, 2988, 2254, 86, 58, "CREW");
  drawRolledFence(ctx, 120, world.height - 92, 240);
  drawRolledFence(ctx, world.width - 420, world.height - 96, 280);
  drawCables(ctx, world);
}

export function drawWarmSpots(ctx: CanvasRenderingContext2D, world: PublicWorld, t: number) {
  const spots = [
    { x: 420, y: 140, r: 220, color: "255, 176, 80", a: 0.16 },
    { x: world.width / 2, y: 160, r: 340, color: "255, 200, 90", a: 0.12 },
    { x: world.width - 420, y: 150, r: 200, color: "220, 120, 140", a: 0.1 },
    { x: 175, y: 900, r: 180, color: "255, 160, 90", a: 0.1 },
    { x: 175, y: 1600, r: 180, color: "255, 160, 90", a: 0.08 },
  ];
  for (const s of spots) {
    const pulse = 0.82 + Math.sin(t * 0.7 + s.x) * 0.18;
    const g = ctx.createRadialGradient(s.x, s.y, 10, s.x, s.y, s.r);
    g.addColorStop(0, `rgba(${s.color},${s.a * pulse})`);
    g.addColorStop(1, `rgba(${s.color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawStringLights(ctx: CanvasRenderingContext2D, world: PublicWorld, t: number) {
  const strings = [
    { y: 58, count: 28, amp: 5, dim: 1 },
    { y: 116, count: 22, amp: 4, dim: 0.75 },
  ];
  for (const s of strings) {
    for (let i = 0; i < s.count; i++) {
      const x = 80 + (i * (world.width - 160)) / (s.count - 1);
      const y = s.y + Math.sin(t * 0.9 + i * 0.6) * s.amp;
      const blink = 0.35 + (0.5 + Math.sin(t * 1.6 + i * 1.7) * 0.5) * 0.5;
      const pink = i % 3 === 1;
      ctx.globalAlpha = blink * s.dim;
      ctx.fillStyle = pink ? PINK_LIT : YELLOW_LIT;
      ctx.beginPath();
      ctx.arc(x, y, pink ? 4.2 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = blink * 0.25 * s.dim;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawHomeNest(ctx: CanvasRenderingContext2D, desk: Desk) {
  const g = ctx.createRadialGradient(desk.seatX, desk.y + 20, 10, desk.seatX, desk.y + 20, 130);
  g.addColorStop(0, "rgba(255, 200, 90, 0.16)");
  g.addColorStop(1, "rgba(255, 200, 90, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(desk.seatX, desk.y + 30, 130, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, desk.x + 18, desk.y + 14, 52, 34, 4, "#1a1a1c");
  roundRect(ctx, desk.x + 22, desk.y + 18, 44, 24, 2, "#2a3a44");
  ctx.fillStyle = "rgba(180, 220, 255, 0.35)";
  ctx.fillRect(desk.x + 24, desk.y + 20, 40, 20);
  ctx.fillStyle = "#2a2420";
  ctx.fillRect(desk.x + 36, desk.y + 46, 18, 4);
  ctx.fillStyle = PINK;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.roundRect(desk.x + 78, desk.y + 18, 28, 22, 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f3ead2";
  ctx.fillRect(desk.x + 82, desk.y + 22, 20, 14);
  ctx.fillStyle = "#3a2a18";
  ctx.fillRect(desk.x + 84, desk.y + 26, 16, 1);
  ctx.fillRect(desk.x + 84, desk.y + 30, 12, 1);
  ctx.fillStyle = "#4a7c9c";
  ctx.beginPath();
  ctx.roundRect(desk.x + 116, desk.y + 16, 12, 28, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(desk.x + 118, desk.y + 18, 8, 8);
  ctx.fillStyle = PINK;
  ctx.font = "800 10px Geist, sans-serif";
  ctx.fillText("thuis", desk.x + 16, desk.y + desk.h - 10);
}

export const DESK_COUNT = 100;
export const DESK_COLS = 10;
export const DESK_ROWS = 10;
export const WORLD_W = 3200;
export const WORLD_H = 2480;
export const PLAYER_R = 28;
export const MAX_SPEED = 420;
export const PROXIMITY = 420;
export const PAUSE_MS = 10 * 60 * 1000;
export const DATE_WAIT_FALLBACK_MS = 45_000;

export const ICEBREAKERS = [
  "Wat studeer je, en waar?",
  "Welk vak zit er nog in je tweede zit?",
  "Koffie, thee of energy drink tijdens het blokken?",
  "Wat is je beste blok-tip?",
  "Welke Pukkelpop-act zou je het liefst zien (als je mocht)?",
  "Blok je liever in stilte of met achtergrondmuziek?",
  "Wat ga je doen als de examens erop zitten?",
  "Ken je al iemand in de tent, of ben je solo gekomen?",
];

function desk(id, x, y) {
  return {
    id,
    x,
    y,
    w: 148,
    h: 86,
    seatX: x + 74,
    seatY: y + 118,
    label: String(id),
  };
}

function makeDesks() {
  const desks = [];
  let id = 1;
  for (let row = 0; row < DESK_ROWS; row++) {
    for (let col = 0; col < DESK_COLS; col++) {
      desks.push(desk(id, 360 + col * 196, 360 + row * 170));
      id += 1;
    }
  }
  return desks;
}

function makeSpeedTables() {
  const tables = [];
  for (let i = 0; i < 6; i++) {
    tables.push({
      id: `sd-${i + 1}`,
      x: WORLD_W - 420,
      y: 400 + i * 220,
      w: 220,
      h: 90,
      label: `Tafel ${i + 1}`,
    });
  }
  return tables;
}

export function createWorld() {
  const desks = makeDesks();
  const speedTables = makeSpeedTables();
  const zones = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 720, h: 150 },
    { id: "stage", name: "Club-podium", x: 840, y: 90, w: 1540, h: 130 },
    { id: "info", name: "Info", x: WORLD_W - 780, y: 90, w: 700, h: 150 },
    { id: "study", name: "Blokzone", x: 330, y: 340, w: 2100, h: 1850 },
    { id: "speeddate", name: "Speeddate", x: WORLD_W - 460, y: 340, w: 400, h: 1900 },
    { id: "lounge", name: "Lounge", x: 50, y: 340, w: 270, h: 1900 },
  ];
  const solids = [
    { x: 0, y: 0, w: WORLD_W, h: 70, wall: true },
    { x: 0, y: WORLD_H - 40, w: WORLD_W, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: WORLD_H, wall: true },
    { x: WORLD_W - 40, y: 0, w: 40, h: WORLD_H, wall: true },
    ...zones.filter((z) => z.id === "bar" || z.id === "stage" || z.id === "info"),
    ...desks.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })),
    ...speedTables.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ];

  return {
    width: WORLD_W,
    height: WORLD_H,
    spawn: { x: WORLD_W / 2, y: WORLD_H - 160 },
    desks,
    speedTables,
    solids,
    zones,
  };
}

export function circleHitsBox(x, y, r, box) {
  const nx = Math.max(box.x, Math.min(x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(y, box.y + box.h));
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy < r * r;
}

export function clampMove(world, fromX, fromY, toX, toY) {
  let x = Math.max(PLAYER_R + 8, Math.min(world.width - PLAYER_R - 8, toX));
  let y = Math.max(PLAYER_R + 8, Math.min(world.height - PLAYER_R - 8, toY));
  for (const box of world.solids) {
    if (circleHitsBox(x, y, PLAYER_R, box)) {
      if (!circleHitsBox(x, fromY, PLAYER_R, box)) y = fromY;
      else if (!circleHitsBox(fromX, y, PLAYER_R, box)) x = fromX;
      else {
        x = fromX;
        y = fromY;
      }
    }
  }
  return { x, y };
}

export function deskById(world, id) {
  return world.desks.find((d) => d.id === Number(id)) || null;
}

export function nearestDesk(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const desk of world.desks) {
    const d = Math.hypot(x - desk.seatX, y - desk.seatY);
    if (d < bestD) {
      best = desk;
      bestD = d;
    }
  }
  return best;
}

export function publicWorld(world) {
  return {
    width: world.width,
    height: world.height,
    spawn: world.spawn,
    desks: world.desks,
    deskCount: world.desks.length,
    speedTables: world.speedTables,
    zones: world.zones,
    proximity: PROXIMITY,
    pauseMs: PAUSE_MS,
  };
}

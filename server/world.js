export const WORLD_W = 2400;
export const WORLD_H = 1680;
export const PLAYER_R = 28;
export const MAX_SPEED = 420;

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
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      desks.push(desk(id, 360 + col * 270, 430 + row * 210));
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
      x: 2050,
      y: 380 + i * 175,
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
  const solids = [
    { x: 0, y: 0, w: WORLD_W, h: 70, wall: true },
    { x: 0, y: WORLD_H - 40, w: WORLD_W, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: WORLD_H, wall: true },
    { x: WORLD_W - 40, y: 0, w: 40, h: WORLD_H, wall: true },
    { x: 80, y: 90, w: 620, h: 150 },
    { x: 760, y: 90, w: 880, h: 120 },
    { x: 1700, y: 90, w: 620, h: 150 },
    ...desks.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })),
    ...speedTables.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ];

  return {
    width: WORLD_W,
    height: WORLD_H,
    spawn: { x: 1200, y: 1520 },
    desks,
    speedTables,
    solids,
    zones: [
      { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 620, h: 150 },
      { id: "stage", name: "Club-podium", x: 760, y: 90, w: 880, h: 120 },
      { id: "info", name: "Info", x: 1700, y: 90, w: 620, h: 150 },
      { id: "study", name: "Blokzone", x: 320, y: 380, w: 1680, h: 900 },
      { id: "speeddate", name: "Speeddate", x: 2000, y: 320, w: 340, h: 1120 },
      { id: "lounge", name: "Lounge", x: 60, y: 320, w: 250, h: 1100 },
    ],
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

export function publicWorld(world) {
  return {
    width: world.width,
    height: world.height,
    spawn: world.spawn,
    desks: world.desks,
    speedTables: world.speedTables,
    zones: world.zones,
  };
}

import type { Desk, PublicWorld, SpeedTable, TalkCircle, Zone } from "./protocol";
import { CIRCLE_MAX, DESK_COUNT, PAUSE_MS, PROXIMITY } from "./protocol";

export const WORLD_W = 3200;
export const WORLD_H = 2480;
export const PLAYER_R = 28;
export const MAX_SPEED = 420;
export const DESK_COLS = 10;
export const DESK_ROWS = Math.ceil(DESK_COUNT / DESK_COLS);
export { PROXIMITY, PAUSE_MS };

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

export type Box = { x: number; y: number; w: number; h: number; wall?: boolean };

export type World = PublicWorld & { solids: Box[] };

function desk(id: number, x: number, y: number): Desk {
  return { id, x, y, w: 148, h: 86, seatX: x + 74, seatY: y + 118, label: String(id) };
}

function makeDesks() {
  const desks: Desk[] = [];
  let id = 1;
  for (let row = 0; row < DESK_ROWS; row++) {
    for (let col = 0; col < DESK_COLS; col++) {
      if (id > DESK_COUNT) break;
      desks.push(desk(id, 360 + col * 196, 360 + row * 170));
      id += 1;
    }
  }
  return desks;
}

function makeSpeedTables(): SpeedTable[] {
  return Array.from({ length: 6 }, (_, i) => {
    const x = WORLD_W - 420;
    const y = 400 + i * 220;
    const w = 220;
    const h = 90;
    return {
      id: `sd-${i + 1}`,
      x,
      y,
      w,
      h,
      label: `Tafel ${i + 1}`,
      seatAx: x + 36,
      seatAy: y + h + 30,
      seatBx: x + w - 36,
      seatBy: y + h + 30,
    };
  });
}

function makeTalkCircles(): TalkCircle[] {
  const loungeX = 185;
  const startY = 520;
  return Array.from({ length: 8 }, (_, i) => ({
    id: `c-${i + 1}`,
    x: loungeX,
    y: startY + i * 220,
    r: 92,
    max: CIRCLE_MAX,
  }));
}

const BAR_COUNTER: Box = { x: 90, y: 98, w: 700, h: 52 };

export function solidsOf(
  world: Pick<PublicWorld, "width" | "height" | "desks" | "speedTables" | "zones">
): Box[] {
  return [
    { x: 0, y: 0, w: world.width, h: 70, wall: true },
    { x: 0, y: world.height - 40, w: world.width, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: world.height, wall: true },
    { x: world.width - 40, y: 0, w: 40, h: world.height, wall: true },
    BAR_COUNTER,
    ...world.zones.filter((z) => z.id === "stage" || z.id === "info"),
    ...world.desks.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })),
    ...world.speedTables.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ];
}

export function createWorld(): World {
  const desks = makeDesks();
  const speedTables = makeSpeedTables();
  const talkCircles = makeTalkCircles();
  const zones: Zone[] = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 720, h: 70 },
    { id: "coffee", name: "Koffiehoek", x: 50, y: 155, w: 780, h: 185 },
    { id: "stage", name: "Club", x: 840, y: 90, w: 1540, h: 130 },
    { id: "info", name: "Info", x: WORLD_W - 780, y: 90, w: 700, h: 150 },
    { id: "study", name: "Blokzone", x: 330, y: 340, w: 2100, h: 1850 },
    { id: "speeddate", name: "Speeddate", x: WORLD_W - 460, y: 340, w: 400, h: 1900 },
    { id: "lounge", name: "Lounge", x: 50, y: 360, w: 270, h: 1880 },
  ];
  const base = {
    width: WORLD_W,
    height: WORLD_H,
    spawn: { x: WORLD_W / 2, y: WORLD_H - 160 },
    desks,
    speedTables,
    talkCircles,
    zones,
    proximity: PROXIMITY,
    pauseMs: PAUSE_MS,
  };

  return { ...base, solids: solidsOf(base) };
}

export function zoneById(world: Pick<PublicWorld, "zones">, id: string) {
  return world.zones.find((z) => z.id === id) || null;
}

export function inZone(world: Pick<PublicWorld, "zones">, x: number, y: number, id: string) {
  const z = zoneById(world, id);
  if (!z) return false;
  return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}

export function inCircle(circle: TalkCircle, x: number, y: number, extra = 0) {
  return Math.hypot(x - circle.x, y - circle.y) <= circle.r + extra;
}

export function tableById(world: Pick<PublicWorld, "speedTables">, id: unknown) {
  return world.speedTables.find((t) => t.id === String(id)) || null;
}

export function circleHitsBox(x: number, y: number, r: number, box: Box) {
  const nx = Math.max(box.x, Math.min(x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(y, box.y + box.h));
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}

export function clampMove(world: World, fromX: number, fromY: number, toX: number, toY: number) {
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

export function deskById(world: World, id: unknown) {
  return world.desks.find((d) => d.id === Number(id)) || null;
}

export function publicWorld(world: World): PublicWorld {
  return {
    width: world.width,
    height: world.height,
    spawn: world.spawn,
    desks: world.desks,
    speedTables: world.speedTables,
    talkCircles: world.talkCircles,
    zones: world.zones,
    proximity: world.proximity,
    pauseMs: world.pauseMs,
  };
}

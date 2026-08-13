import type { Desk, PublicWorld, SpeedTable, Zone } from "./protocol";
import { DESK_COUNT } from "./protocol";

export const WORLD_W = 2400;
export const WORLD_H = 1680;
export const PLAYER_R = 28;
export const MAX_SPEED = 420;
export const DESK_COLS = 6;
export const DESK_ROWS = Math.ceil(DESK_COUNT / DESK_COLS);

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
      desks.push(desk(id, 360 + col * 270, 430 + row * 210));
      id += 1;
    }
  }
  return desks;
}

function makeSpeedTables(): SpeedTable[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `sd-${i + 1}`,
    x: 2050,
    y: 380 + i * 175,
    w: 220,
    h: 90,
    label: `Tafel ${i + 1}`,
  }));
}

export function createWorld(): World {
  const desks = makeDesks();
  const speedTables = makeSpeedTables();
  const zones: Zone[] = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 620, h: 150 },
    { id: "stage", name: "Club", x: 760, y: 90, w: 880, h: 120 },
    { id: "info", name: "Info", x: 1700, y: 90, w: 620, h: 150 },
    { id: "study", name: "Blokzone", x: 320, y: 380, w: 1680, h: 900 },
    { id: "speeddate", name: "Speeddate", x: 2000, y: 320, w: 340, h: 1120 },
    { id: "lounge", name: "Lounge", x: 60, y: 320, w: 250, h: 1100 },
  ];
  const solids: Box[] = [
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
    zones,
  };
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
    zones: world.zones,
  };
}

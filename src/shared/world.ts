import type {
  DaySlot,
  DaySlotId,
  Desk,
  InfoBoard,
  PublicWorld,
  School,
  SchoolCorner,
  Seat,
  SpeedTable,
  TalkCircle,
  WorldBlocker,
  Zone,
} from "./protocol";
import { CIRCLE_MAX, DESK_COUNT, PAUSE_MS, PROXIMITY } from "./protocol";

export const WORLD_W = 3200;
export const WORLD_H = 2480;
export const PLAYER_R = 28;
export const MAX_SPEED = 420;
export const DESK_COLS = 10;
export const DESK_ROWS = Math.ceil(DESK_COUNT / DESK_COLS);
export { PROXIMITY, PAUSE_MS };

export const DAY_SLOTS: DaySlot[] = [
  { id: "stil", time: "09:00", title: "Stil blokken", subtitle: "Koppen bij de boeken." },
  { id: "koffie", time: "11:00", title: "Koffie", subtitle: "Even rechtstaan, haal een kop." },
  { id: "lunch", time: "12:30", title: "Lunch / friet", subtitle: "De tent mag even lawaai maken." },
  { id: "backstage", time: "14:00", title: "Backstage", subtitle: "Terug naar je bureau." },
  { id: "speeddate", time: "16:30", title: "Speeddate", subtitle: "Rechts in de tent, drie minuten." },
  { id: "einde", time: "17:30", title: "Afronden", subtitle: "Pak je spullen, tot op PKP." },
];

export const HOST_MOMENT_COPY = {
  stand: { moment: "Iedereen even rechtstaan", announce: "Iedereen even rechtstaan — stretch, water, en terug." },
  "speeddate-open": { moment: "Speeddate-hoek is open", announce: "De speeddate-hoek is open. Rechts in de tent, drie minuten." },
  silence: { moment: "Stilte tot 16u", announce: "Stilte tot 16u. Blokken = blijven zitten." },
} as const;

export function slotForHour(date = new Date()): DaySlotId {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < 11) return "stil";
  if (hour < 12.5) return "koffie";
  if (hour < 14) return "lunch";
  if (hour < 16.5) return "backstage";
  if (hour < 17.5) return "speeddate";
  return "einde";
}

export function boardFromSlot(slotId: DaySlotId, moment: string | null = null): InfoBoard {
  const slot = DAY_SLOTS.find((s) => s.id === slotId) || DAY_SLOTS[0];
  return { slotId: slot.id, title: slot.title, subtitle: slot.subtitle, moment };
}

export function defaultBoard(date = new Date()): InfoBoard {
  return boardFromSlot(slotForHour(date));
}

export function onboardText(deskId: number) {
  return `Je zit aan bureau ${deskId}. Blokken = blijven zitten. Pauze = lounge of koffie. Kennismaken = rondlopen.`;
}

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

function makeSeats(circles: TalkCircle[]): Seat[] {
  const seats: Seat[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 130 + i * 108;
    const y = 188;
    seats.push({
      id: `stool-${i + 1}`,
      kind: "stool",
      x,
      y,
      w: 46,
      h: 40,
      seatX: x + 23,
      seatY: y + 52,
    });
  }
  circles.forEach((c, i) => {
    seats.push({
      id: `lounge-${i + 1}a`,
      kind: "lounge",
      x: 58,
      y: c.y - 38,
      w: 72,
      h: 34,
      seatX: 128,
      seatY: c.y - 16,
    });
    seats.push({
      id: `lounge-${i + 1}b`,
      kind: "lounge",
      x: 58,
      y: c.y + 6,
      w: 72,
      h: 34,
      seatX: 128,
      seatY: c.y + 24,
    });
  });
  return seats;
}

function makeSchoolCorners(): SchoolCorner[] {
  const specs: { id: SchoolCorner["id"]; school: School; label: string; y: number }[] = [
    { id: "corner-pxl", school: "PXL", label: "PXL", y: 1680 },
    { id: "corner-ucll", school: "UCLL", label: "UCLL", y: 1840 },
    { id: "corner-uhasselt", school: "Universiteit Hasselt", label: "UHasselt", y: 2000 },
    { id: "corner-andere", school: "Andere", label: "Andere", y: 2160 },
  ];
  return specs.map((s) => ({ ...s, x: 56, w: 250, h: 140 }));
}

export function schoolCornerAt(world: Pick<PublicWorld, "schoolCorners">, x: number, y: number) {
  return (world.schoolCorners || []).find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) || null;
}

function makeBlockers(): WorldBlocker[] {
  return [
    { x: 86, y: 86, w: 708, h: 64 },
    { x: 860, y: 62, w: 1500, h: 48 },
    { x: WORLD_W - 760, y: 86, w: 680, h: 148 },
    { x: 92, y: 2268, w: 78, h: 54 },
    { x: 186, y: 2284, w: 58, h: 42 },
    { x: 2988, y: 2254, w: 86, h: 58 },
    { x: 120, y: WORLD_H - 92, w: 240, h: 28 },
    { x: WORLD_W - 420, y: WORLD_H - 96, w: 280, h: 28 },
  ];
}

export function solidsOf(
  world: Pick<PublicWorld, "width" | "height" | "desks" | "speedTables" | "blockers">
): Box[] {
  return [
    { x: 0, y: 0, w: world.width, h: 70, wall: true },
    { x: 0, y: world.height - 40, w: world.width, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: world.height, wall: true },
    { x: world.width - 40, y: 0, w: 40, h: world.height, wall: true },
    ...(world.blockers || []),
    ...world.desks.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })),
    ...world.speedTables.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ];
}

export function seatById(world: Pick<PublicWorld, "seats">, id: unknown) {
  return (world.seats || []).find((s) => s.id === String(id || "")) || null;
}

export function createWorld(): World {
  const desks = makeDesks();
  const speedTables = makeSpeedTables();
  const talkCircles = makeTalkCircles();
  const seats = makeSeats(talkCircles);
  const blockers = makeBlockers();
  const schoolCorners = makeSchoolCorners();
  const board = defaultBoard();
  const zones: Zone[] = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 720, h: 70 },
    { id: "coffee", name: "Koffiehoek", x: 50, y: 155, w: 780, h: 185 },
    { id: "stage", name: "Club", x: 840, y: 90, w: 1540, h: 160 },
    { id: "info", name: "Dagprogramma", x: WORLD_W - 780, y: 90, w: 700, h: 170 },
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
    seats,
    blockers,
    schoolCorners,
    daySlots: DAY_SLOTS,
    board,
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
    seats: world.seats,
    blockers: world.blockers,
    schoolCorners: world.schoolCorners,
    daySlots: world.daySlots,
    board: world.board,
    proximity: world.proximity,
    pauseMs: world.pauseMs,
  };
}

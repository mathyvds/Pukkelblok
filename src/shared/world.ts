import type {
  DaySlot,
  DaySlotId,
  Desk,
  DeskStyle,
  InfoBoard,
  PublicWorld,
  School,
  SchoolCorner,
  Seat,
  SpeedTable,
  StudyTable,
  TalkCircle,
  WorldBlocker,
  Zone,
} from "./protocol";
import { CIRCLE_MAX, DESK_COUNT, DESK_STYLES, PAUSE_MS, PROXIMITY, TABLE_SEATS } from "./protocol";

export const WORLD_W = 3200;
export const WORLD_H = 2480;
export const PLAYER_R = 22;
export const MAX_SPEED = 420;
export const TABLE_COLS = 5;
export const TABLE_ROWS = Math.ceil(DESK_COUNT / (TABLE_COLS * TABLE_SEATS));
export const TABLE_W = 216;
export const TABLE_H = 96;
export const TABLE_GAP_X = 136;
export const TABLE_GAP_Y = 168;
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

function deskStyleFor(id: number): DeskStyle {
  return DESK_STYLES[(id - 1) % DESK_STYLES.length];
}

function makeTablesAndDesks(): { desks: Desk[]; tables: StudyTable[] } {
  const desks: Desk[] = [];
  const tables: StudyTable[] = [];
  const originX = 392;
  const originY = 428;
  let id = 1;
  let tableN = 1;
  for (let row = 0; row < TABLE_ROWS; row++) {
    for (let col = 0; col < TABLE_COLS; col++) {
      if (id > DESK_COUNT) break;
      const x = originX + col * (TABLE_W + TABLE_GAP_X);
      const y = originY + row * (TABLE_H + TABLE_GAP_Y);
      const tableId = `tbl-${tableN}`;
      const deskIds: number[] = [];
      const seats = [
        { ox: 54, oy: -22 },
        { ox: 162, oy: -22 },
        { ox: 54, oy: TABLE_H + 30 },
        { ox: 162, oy: TABLE_H + 30 },
      ];
      for (const seat of seats) {
        if (id > DESK_COUNT) break;
        deskIds.push(id);
        desks.push({
          id,
          x,
          y,
          w: TABLE_W,
          h: TABLE_H,
          seatX: x + seat.ox,
          seatY: y + seat.oy,
          label: String(id),
          tableId,
          style: deskStyleFor(id),
        });
        id += 1;
      }
      tables.push({
        id: tableId,
        x,
        y,
        w: TABLE_W,
        h: TABLE_H,
        label: `Tafel ${tableN}`,
        deskIds,
      });
      tableN += 1;
    }
  }
  return { desks, tables };
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
  world: Pick<PublicWorld, "width" | "height" | "tables" | "speedTables" | "blockers">
): Box[] {
  const tables = world.tables || [];
  return [
    { x: 0, y: 0, w: world.width, h: 70, wall: true },
    { x: 0, y: world.height - 40, w: world.width, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: world.height, wall: true },
    { x: world.width - 40, y: 0, w: 40, h: world.height, wall: true },
    ...(world.blockers || []),
    ...tables.map((t) => ({ x: t.x + 10, y: t.y + 8, w: t.w - 20, h: t.h - 16 })),
    ...world.speedTables.map((t) => ({ x: t.x + 18, y: t.y + 8, w: t.w - 36, h: t.h - 28 })),
  ];
}

export function seatById(world: Pick<PublicWorld, "seats">, id: unknown) {
  return (world.seats || []).find((s) => s.id === String(id || "")) || null;
}

export function createWorld(): World {
  const { desks, tables } = makeTablesAndDesks();
  const speedTables = makeSpeedTables();
  const talkCircles = makeTalkCircles();
  const seats = makeSeats(talkCircles);
  const blockers = makeBlockers();
  const schoolCorners = makeSchoolCorners();
  const board = defaultBoard();
  const zones: Zone[] = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 720, h: 70 },
    { id: "coffee", name: "Koffiehoek", x: 50, y: 155, w: 780, h: 185 },
    { id: "stage", name: "Club", x: 840, y: 70, w: 1540, h: 230 },
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
    tables,
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

function resolveCircleBox(x: number, y: number, r: number, box: Box) {
  const inside = x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
  if (inside) {
    const left = x - box.x;
    const right = box.x + box.w - x;
    const top = y - box.y;
    const bottom = box.y + box.h - y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { x: box.x - r, y };
    if (m === right) return { x: box.x + box.w + r, y };
    if (m === top) return { x, y: box.y - r };
    return { x, y: box.y + box.h + r };
  }
  const nx = Math.max(box.x, Math.min(x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(y, box.y + box.h));
  const dx = x - nx;
  const dy = y - ny;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist >= r) return { x, y };
  const push = (r - dist) / dist + 0.05;
  return { x: x + dx * push, y: y + dy * push };
}

export function clampMove(world: World, fromX: number, fromY: number, toX: number, toY: number) {
  const minX = PLAYER_R + 8;
  const maxX = world.width - PLAYER_R - 8;
  const minY = PLAYER_R + 8;
  const maxY = world.height - PLAYER_R - 8;
  const hits = (x: number, y: number) => world.solids.some((box) => circleHitsBox(x, y, PLAYER_R, box));

  let x = Math.max(minX, Math.min(maxX, toX));
  let y = fromY;
  if (hits(x, y)) {
    const resolved = resolveCircleBox(x, y, PLAYER_R, world.solids.find((box) => circleHitsBox(x, y, PLAYER_R, box))!);
    x = Math.max(minX, Math.min(maxX, resolved.x));
    if (hits(x, y)) x = fromX;
  }

  y = Math.max(minY, Math.min(maxY, toY));
  if (hits(x, y)) {
    const box = world.solids.find((b) => circleHitsBox(x, y, PLAYER_R, b));
    if (box) {
      const resolved = resolveCircleBox(x, y, PLAYER_R, box);
      y = Math.max(minY, Math.min(maxY, resolved.y));
    }
    if (hits(x, y)) y = fromY;
  }

  if (hits(x, y)) return { x: fromX, y: fromY };
  return { x, y };
}

export function deskById(world: World, id: unknown) {
  return world.desks.find((d) => d.id === Number(id)) || null;
}

export function studyTableById(world: Pick<PublicWorld, "tables">, id: unknown) {
  return (world.tables || []).find((t) => t.id === String(id || "")) || null;
}

export function tableForDesk(world: Pick<PublicWorld, "tables" | "desks">, deskId: unknown) {
  const desk = world.desks.find((d) => d.id === Number(deskId));
  if (!desk) return null;
  return studyTableById(world, desk.tableId);
}

export function desksOfTable(world: Pick<PublicWorld, "desks">, tableId: string) {
  return world.desks.filter((d) => d.tableId === tableId);
}

export function nearestStudyTable(world: Pick<PublicWorld, "tables" | "desks">, x: number, y: number, maxDist = 110) {
  let best: StudyTable | null = null;
  let bestD = maxDist;
  for (const table of world.tables || []) {
    const cx = table.x + table.w / 2;
    const cy = table.y + table.h / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) {
      best = table;
      bestD = d;
    }
  }
  if (best) return best;
  for (const desk of world.desks) {
    const d = Math.hypot(x - desk.seatX, y - desk.seatY);
    if (d < bestD) {
      best = studyTableById(world, desk.tableId);
      bestD = d;
    }
  }
  return best;
}

export function inTableBubble(status: string | undefined, sittingDeskId: number | null | undefined, studyingSilent = true) {
  if (!sittingDeskId) return false;
  if (studyingSilent && status === "studeren") return false;
  return true;
}

export function publicWorld(world: World): PublicWorld {
  return {
    width: world.width,
    height: world.height,
    spawn: world.spawn,
    desks: world.desks,
    tables: world.tables,
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

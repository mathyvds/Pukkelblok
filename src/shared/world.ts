import type {
  DaySlot,
  DaySlotId,
  Desk,
  InfoBoard,
  PublicWorld,
  School,
  SchoolCorner,
  SpeedTable,
  TalkCircle,
  Zone,
} from "./protocol";
import { DESK_COUNT, PAUSE_MS, PROXIMITY, TALK_CIRCLE_CAP } from "./protocol";

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

export const DAY_SLOTS: DaySlot[] = [
  { id: "stil", time: "09:00", title: "Stil blokken", subtitle: "Koppen bij de boeken." },
  { id: "koffie", time: "11:00", title: "Koffie", subtitle: "Even rechtstaan, haal een kop." },
  { id: "lunch", time: "12:30", title: "Lunch / friet", subtitle: "Frietje, dan weer blokken." },
  { id: "backstage", time: "14:00", title: "Backstage", subtitle: "Kijk eens rond in de tent." },
  { id: "speeddate", time: "16:30", title: "Speeddate", subtitle: "Drie minuten. Eén ijsbreker." },
  { id: "einde", time: "17:30", title: "Afronden", subtitle: "Laatste ronde, dan uitblazen." },
];

export const HOST_MOMENT_COPY: Record<
  "stand" | "speeddate-open" | "silence",
  { moment: string; announce: string }
> = {
  stand: {
    moment: "Iedereen even rechtstaan",
    announce: "Iedereen even rechtstaan — stretch, water, en terug.",
  },
  "speeddate-open": {
    moment: "Speeddate-hoek is open",
    announce: "De speeddate-hoek is open. Rechts in de tent, drie minuten.",
  },
  silence: {
    moment: "Stilte tot 16u",
    announce: "Stilte tot 16u. Blokken = blijven zitten.",
  },
};

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
      seats: [
        { x: x + 36, y: y + h + 28 },
        { x: x + w - 36, y: y + h + 28 },
      ],
    };
  });
}

function makeTalkCircles(): TalkCircle[] {
  return [
    { id: "bank-1", label: "Bank 1", x: 185, y: 1220, r: 110, cap: TALK_CIRCLE_CAP },
    { id: "bank-2", label: "Bank 2", x: 185, y: 1480, r: 110, cap: TALK_CIRCLE_CAP },
    { id: "bank-3", label: "Bank 3", x: 185, y: 1740, r: 110, cap: TALK_CIRCLE_CAP },
    { id: "bank-4", label: "Bank 4", x: 185, y: 2000, r: 110, cap: TALK_CIRCLE_CAP },
  ];
}

function makeSchoolCorners(): SchoolCorner[] {
  const specs: { id: SchoolCorner["id"]; school: School; label: string; y: number }[] = [
    { id: "corner-pxl", school: "PXL", label: "PXL", y: 400 },
    { id: "corner-ucll", school: "UCLL", label: "UCLL", y: 580 },
    { id: "corner-uhasselt", school: "Universiteit Hasselt", label: "UHasselt", y: 760 },
    { id: "corner-andere", school: "Andere", label: "Andere", y: 940 },
  ];
  return specs.map((s) => ({ ...s, x: 58, w: 254, h: 170 }));
}

export function solidsOf(
  world: Pick<PublicWorld, "width" | "height" | "desks" | "speedTables" | "zones">
): Box[] {
  return [
    { x: 0, y: 0, w: world.width, h: 70, wall: true },
    { x: 0, y: world.height - 40, w: world.width, h: 40, wall: true },
    { x: 0, y: 0, w: 40, h: world.height, wall: true },
    { x: world.width - 40, y: 0, w: 40, h: world.height, wall: true },
    ...world.zones.filter((z) => z.id === "bar" || z.id === "stage" || z.id === "info"),
    ...world.desks.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h })),
    ...world.speedTables.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ];
}

export function slotForHour(date = new Date()): DaySlotId {
  const parts = new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const mins = hour * 60 + minute;
  if (mins >= 17 * 60 + 30) return "einde";
  if (mins >= 16 * 60 + 30) return "speeddate";
  if (mins >= 14 * 60) return "backstage";
  if (mins >= 12 * 60 + 30) return "lunch";
  if (mins >= 11 * 60) return "koffie";
  return "stil";
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

export function createWorld(board: InfoBoard = defaultBoard()): World {
  const desks = makeDesks();
  const speedTables = makeSpeedTables();
  const talkCircles = makeTalkCircles();
  const schoolCorners = makeSchoolCorners();
  const zones: Zone[] = [
    { id: "bar", name: "Koffiebar", x: 80, y: 90, w: 720, h: 150 },
    { id: "cafe", name: "Koffiebar", x: 80, y: 240, w: 720, h: 100 },
    { id: "stage", name: "Club", x: 840, y: 90, w: 1540, h: 130 },
    { id: "info", name: "Info", x: WORLD_W - 780, y: 90, w: 700, h: 150 },
    { id: "study", name: "Blokzone", x: 330, y: 340, w: 2100, h: 1850 },
    { id: "speeddate", name: "Speeddate", x: WORLD_W - 460, y: 340, w: 400, h: 1900 },
    { id: "lounge", name: "Lounge", x: 50, y: 340, w: 270, h: 1900 },
  ];
  const base: PublicWorld = {
    width: WORLD_W,
    height: WORLD_H,
    spawn: { x: WORLD_W / 2, y: WORLD_H - 160 },
    desks,
    speedTables,
    zones,
    talkCircles,
    schoolCorners,
    daySlots: DAY_SLOTS,
    board,
    proximity: PROXIMITY,
    pauseMs: PAUSE_MS,
  };

  return { ...base, solids: solidsOf(base) };
}

export function inBox(box: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

export function pointInCircle(cx: number, cy: number, r: number, x: number, y: number) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

export function talkCircleAt(world: Pick<PublicWorld, "talkCircles">, x: number, y: number) {
  return world.talkCircles.find((c) => pointInCircle(c.x, c.y, c.r, x, y)) || null;
}

export function schoolCornerAt(world: Pick<PublicWorld, "schoolCorners">, x: number, y: number) {
  return world.schoolCorners.find((c) => inBox(c, x, y)) || null;
}

export function zoneAt(world: Pick<PublicWorld, "zones">, id: string) {
  return world.zones.find((z) => z.id === id) || null;
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

export function speedTableById(world: Pick<PublicWorld, "speedTables">, id: unknown) {
  return world.speedTables.find((t) => t.id === String(id)) || null;
}

export function publicWorld(world: World): PublicWorld {
  return {
    width: world.width,
    height: world.height,
    spawn: world.spawn,
    desks: world.desks,
    speedTables: world.speedTables,
    zones: world.zones,
    talkCircles: world.talkCircles,
    schoolCorners: world.schoolCorners,
    daySlots: world.daySlots,
    board: world.board,
    proximity: world.proximity,
    pauseMs: world.pauseMs,
  };
}

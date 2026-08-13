import { z } from "zod";

export const MAX_ONLINE = 100;
export const MAX_AVATAR_BYTES = 100_000;
export const MAX_CHAT = 200;

export const statuses = ["kennismaken", "studeren", "pauze"] as const;
export type Status = (typeof statuses)[number];

export const SCHOOLS = ["PXL", "UCLL", "Universiteit Hasselt", "Andere"] as const;
export type School = (typeof SCHOOLS)[number];

export const DESK_COUNT = 100;
export const PROXIMITY = 420;
export const WHISPER_PROXIMITY = 160;
export const PAUSE_MS = 10 * 60 * 1000;
export const CHAT_COOLDOWN_MS = 700;
export const SHOUT_COOLDOWN_MS = 60_000;
export const DATE_WAIT_FALLBACK_MS = 45_000;
export const CIRCLE_MAX = 4;
export const STUDY_MINUTES = [25, 50] as const;
export type StudyMinutes = (typeof STUDY_MINUTES)[number];
export const DEFAULT_STUDY_MINUTES: StudyMinutes = 50;

export const chatScopes = ["near", "tent", "circle", "coffee", "date"] as const;
export type ChatScope = (typeof chatScopes)[number];

export type PublicPlayer = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  color: string;
  x: number;
  y: number;
  facing: 1 | -1;
  moving: boolean;
  sittingDeskId: number | null;
  sittingSpotId: string | null;
  homeDeskId: number;
  age: number;
  school: string;
  program: string;
  status: Status;
  statusText: string;
  pauseUntil: number;
  typing: boolean;
  bubble: string;
  inDate: boolean;
  talkCircleId: string | null;
  dateTableId: string | null;
  studyUntil: number;
};

export type ChatMessage = {
  id: string;
  from: string;
  firstName: string;
  lastName: string;
  text: string;
  scope: ChatScope;
  at: number;
};

export type DirectMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  at: number;
};

export type MovePayload = {
  x: number;
  y: number;
  facing: 1 | -1;
  moving: boolean;
};

export type PlayerMove = MovePayload & {
  id: string;
  sittingDeskId: number | null;
  sittingSpotId: string | null;
};

export type Desk = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  seatX: number;
  seatY: number;
  label: string;
};

export type SpeedTable = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  seatAx: number;
  seatAy: number;
  seatBx: number;
  seatBy: number;
};

export type TalkCircle = {
  id: string;
  x: number;
  y: number;
  r: number;
  max: number;
};

export type Zone = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SeatKind = "stool" | "lounge";

export type Seat = {
  id: string;
  kind: SeatKind;
  x: number;
  y: number;
  w: number;
  h: number;
  seatX: number;
  seatY: number;
};

export type WorldBlocker = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PublicWorld = {
  width: number;
  height: number;
  spawn: { x: number; y: number };
  desks: Desk[];
  speedTables: SpeedTable[];
  talkCircles: TalkCircle[];
  zones: Zone[];
  seats: Seat[];
  blockers: WorldBlocker[];
  proximity: number;
  pauseMs: number;
};

export type HelloPayload = {
  you: PublicPlayer;
  players: PublicPlayer[];
  chat: ChatMessage[];
  world: PublicWorld;
  online: number;
  max: number;
};

export type ClientToServerEvents = {
  move: (data: MovePayload) => void;
  sit: (deskId: number) => void;
  "sit:spot": (spotId: string) => void;
  stand: () => void;
  status: (data: { status: Status; statusText?: string; studyMinutes?: number }) => void;
  typing: (data: { typing: boolean }) => void;
  chat: (text: string) => void;
  shout: (text: string) => void;
  "dm:open": (otherId: string) => void;
  dm: (data: { to: string; text: string }) => void;
  "speeddate:join": (data?: { preferSameStudy?: boolean }) => void;
  "speeddate:leave": () => void;
};

export type ServerToClientEvents = {
  hello: (payload: HelloPayload) => void;
  presence: (payload: { online: number; max: number }) => void;
  "player:join": (player: PublicPlayer) => void;
  "player:leave": (payload: { id: string }) => void;
  "player:update": (player: PublicPlayer) => void;
  "player:correct": (player: PublicPlayer) => void;
  "players:moves": (moves: PlayerMove[]) => void;
  "player:typing": (payload: { id: string; typing: boolean; x?: number; y?: number }) => void;
  "player:bubble-end": (payload: { id: string }) => void;
  chat: (msg: ChatMessage) => void;
  dm: (msg: DirectMessage) => void;
  "dm:history": (payload: { with: string; messages: DirectMessage[] }) => void;
  notice: (payload: { type: string; text: string }) => void;
  announce: (payload: { text: string; at: number }) => void;
  kicked: (payload: { reason: string }) => void;
  "speeddate:queued": (payload: { queued: boolean; position: number }) => void;
  "speeddate:matched": (payload: {
    partner: PublicPlayer;
    endsAt: number;
    ice: string;
    waiting: number;
    tableId: string;
    tableLabel: string;
  }) => void;
  "speeddate:ended": (payload: { reason: string }) => void;
  "speeddate:waiting": (payload: { waiting: number }) => void;
};

export const joinSchema = z.object({
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(60),
  age: z.number().int().min(15).max(80),
  school: z.string().min(2).max(40),
  program: z.string().min(2).max(60),
  deskId: z.number().int().min(1).max(DESK_COUNT),
  avatar: z.union([
    z.object({ preset: z.number().int().min(1).max(8) }),
    z.object({ dataUrl: z.string().min(20).max(180_000) }),
  ]),
});

export type JoinBody = z.infer<typeof joinSchema>;

import { z } from "zod";

export const MAX_ONLINE = 100;
export const MAX_AVATAR_BYTES = 100_000;
export const MAX_CHAT = 200;

export const statuses = ["kennismaken", "blokken", "pauze"] as const;
export type Status = (typeof statuses)[number];

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
  status: Status;
  statusText: string;
  typing: boolean;
  draft: string;
  bubble: string;
  inDate: boolean;
};

export type ChatMessage = {
  id: string;
  from: string;
  firstName: string;
  lastName: string;
  text: string;
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
};

export type Zone = {
  id: string;
  name: string;
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
  zones: Zone[];
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
  stand: () => void;
  status: (data: { status: Status; statusText?: string }) => void;
  typing: (data: { typing: boolean; draft: string }) => void;
  chat: (text: string) => void;
  "dm:open": (otherId: string) => void;
  dm: (data: { to: string; text: string }) => void;
  "speeddate:join": () => void;
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
  "player:typing": (payload: { id: string; typing: boolean; draft: string }) => void;
  "player:bubble-end": (payload: { id: string }) => void;
  chat: (msg: ChatMessage) => void;
  dm: (msg: DirectMessage) => void;
  "dm:history": (payload: { with: string; messages: DirectMessage[] }) => void;
  notice: (payload: { type: string; text: string }) => void;
  "speeddate:queued": (payload: { queued: boolean; position: number }) => void;
  "speeddate:matched": (payload: {
    partner: PublicPlayer;
    endsAt: number;
    ice: string;
    waiting: number;
  }) => void;
  "speeddate:ended": (payload: { reason: string }) => void;
  "speeddate:waiting": (payload: { waiting: number }) => void;
};

export const joinSchema = z.object({
  firstName: z.string().min(1).max(40),
  lastName: z.string().min(1).max(60),
  avatar: z.union([
    z.object({ preset: z.number().int().min(1).max(8) }),
    z.object({ dataUrl: z.string().min(20).max(180_000) }),
  ]),
});

export type JoinBody = z.infer<typeof joinSchema>;

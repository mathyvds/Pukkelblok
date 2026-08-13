import crypto from "node:crypto";
import type {
  ChatMessage,
  ChatScope,
  DaySlotId,
  DirectMessage,
  IceSource,
  InfoBoard,
  PlayerMove,
  PublicPlayer,
  Report,
  Status,
  StudyMinutes,
  WaveEmoji,
  ZoneCount,
} from "../shared/protocol";
import {
  CHAT_COOLDOWN_MS,
  DATE_CONTINUE_MS,
  DATE_WAIT_FALLBACK_MS,
  DEFAULT_STUDY_MINUTES,
  MAX_ONLINE,
  PAUSE_MS,
  PROXIMITY,
  SHOUT_COOLDOWN_MS,
  STUDY_MINUTES,
  STUDY_PAUSE_MS,
  WAVE_COOLDOWN_MS,
  WAVE_MS,
  WHISPER_PROXIMITY,
} from "../shared/protocol";
import { shirtColor, validateStatus, validateStatusText, validateStudyMinutes, type AvatarPhoto, type AvatarPreset } from "../shared/validate";
import {
  boardFromSlot,
  clampMove,
  defaultBoard,
  deskById,
  desksOfTable,
  ICEBREAKERS,
  inCircle,
  inTableBubble,
  inZone,
  MAX_SPEED,
  seatById,
  studyTableById,
  tableForDesk,
  type World,
} from "../shared/world";
import type { DeskStyle } from "../shared/protocol";
import { DESK_STYLES } from "../shared/protocol";
import { loadHostState, saveHostState, type KickRecord } from "./persist";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BUBBLE_MS = 7000;
const DATE_MS = 3 * 60 * 1000;

type AvatarInput = AvatarPreset | AvatarPhoto;

export type User = {
  id: string;
  sid: string;
  firstName: string;
  lastName: string;
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
  draft: string;
  bubble: string;
  bubbleUntil: number;
  lastChatAt: number;
  lastShoutAt: number;
  online: boolean;
  lastMoveAt: number;
  createdAt: number;
  avatarVersion: number;
  avatarUrl: string;
  preset: number | null;
  mime: string;
  socketId?: string;
  disconnectedAt?: number;
  present: boolean;
  talkCircleId: string | null;
  dateTableId: string | null;
  studyUntil: number;
  lastStudyMinutes: StudyMinutes;
  waving: string;
  waveUntil: number;
  lastWaveAt: number;
  blocked: Set<string>;
  deskStyle: DeskStyle;
  isBot: boolean;
};

type DateMatch = {
  a: string;
  b: string;
  endsAt: number;
  ice: string;
  tableId: string;
  tableLabel: string;
  phase: "dating" | "ask";
  continueUntil?: number;
  yes: Record<string, boolean>;
  reason?: string;
};

export function createStore(world: World, opts?: { persistPath?: string }) {
  const users = new Map<string, User>();
  const sessions = new Map<string, string>();
  const avatars = new Map<string, { buffer: Buffer; mime: string }>();
  const sockets = new Map<string, string>();
  const chat: ChatMessage[] = [];
  const dms = new Map<string, DirectMessage[]>();
  const dateQueue: { id: string; queuedAt: number; preferSameStudy: boolean }[] = [];
  const dates = new Map<string, DateMatch>();
  const pendingMoves: PlayerMove[] = [];
  const persistPath = opts?.persistPath;
  const loaded = persistPath ? loadHostState(persistPath) : { reports: [] as Report[], kicked: [] as KickRecord[] };
  const kicked: KickRecord[] = [...loaded.kicked];
  const reports: Report[] = [...loaded.reports];
  let board: InfoBoard = world.board || defaultBoard();
  let lastDisplaced: PublicPlayer[] = [];

  function persistHost() {
    if (!persistPath) return;
    saveHostState(persistPath, { reports: reports.slice(-40), kicked: kicked.slice(-80) });
  }

  function isKickedSid(sid: string | undefined) {
    return Boolean(sid && kicked.some((k) => k.sid === sid));
  }

  function isKickedIdentity(key: string) {
    return kicked.some((k) => k.identity === key);
  }

  function publicUser(user: User): PublicPlayer {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      color: user.color,
      x: user.x,
      y: user.y,
      facing: user.facing,
      moving: user.moving,
      sittingDeskId: user.sittingDeskId,
      sittingSpotId: user.sittingSpotId,
      homeDeskId: user.homeDeskId,
      age: user.age,
      school: user.school,
      program: user.program,
      status: user.status,
      statusText: user.statusText,
      pauseUntil: user.pauseUntil || 0,
      typing: user.typing,
      bubble: user.bubble,
      inDate: dates.has(user.id),
      talkCircleId: user.talkCircleId,
      dateTableId: user.dateTableId,
      studyUntil: user.studyUntil || 0,
      waving: user.waving || "",
      tableId: socialTableId(user),
      deskStyle: user.deskStyle,
      isBot: Boolean(user.isBot),
    };
  }

  function socialTableId(user: User) {
    if (user.dateTableId) return user.dateTableId;
    if (!inTableBubble(user.status, user.sittingDeskId)) return null;
    return tableForDesk(world, user.sittingDeskId)?.id || null;
  }

  function parseDeskStyle(value: unknown): DeskStyle {
    return (DESK_STYLES as readonly string[]).includes(String(value)) ? (value as DeskStyle) : "laptop";
  }

  function isSilent(user: User) {
    return user.status === "studeren";
  }

  function parseStudyMinutes(value: unknown): StudyMinutes {
    const n = Number(value);
    return (STUDY_MINUTES as readonly number[]).includes(n) ? (n as StudyMinutes) : DEFAULT_STUDY_MINUTES;
  }

  function studyDurationMs(value: unknown) {
    return parseStudyMinutes(value) * 60 * 1000;
  }

  function dmKey(a: string, b: string) {
    return [a, b].sort().join(":");
  }

  function get(id: string) {
    return users.get(id) || null;
  }

  function getBySid(sid: string | undefined) {
    if (!sid) return null;
    const id = sessions.get(sid);
    return id ? get(id) : null;
  }

  function onlineCount() {
    let n = 0;
    for (const user of users.values()) if (user.online) n += 1;
    return n;
  }

  function holdsDesk(user: User, deskId: number, now: number) {
    if (user.homeDeskId === deskId) return true;
    if (user.sittingDeskId !== deskId) return false;
    if (user.online) return true;
    if (!user.disconnectedAt) return true;
    return now - user.disconnectedAt < 30_000;
  }

  function occupyDesk(deskId: number, userId: string) {
    const now = Date.now();
    for (const user of users.values()) {
      if (user.id === userId) continue;
      if (holdsDesk(user, deskId, now)) return false;
    }
    return true;
  }

  function deskOccupancy() {
    const now = Date.now();
    return world.desks.map((desk) => {
      const holders = [...users.values()].filter((u) => holdsDesk(u, desk.id, now));
      const sitter = holders.find((u) => u.online || u.present) || holders[0];
      const taken = holders.length > 0;
      return {
        id: desk.id,
        taken,
        by: taken && sitter ? `${sitter.firstName} ${sitter.lastName}` : null,
      };
    });
  }

  function zoneOccupancy(): ZoneCount[] {
    const ids = ["study", "lounge", "coffee"];
    return ids.map((id) => {
      const zone = world.zones.find((z) => z.id === id);
      let count = 0;
      if (zone) {
        for (const user of users.values()) {
          if (user.online && inZone(world, user.x, user.y, id)) count += 1;
        }
      }
      return { id, name: zone?.name || id, count };
    });
  }

  function setBoard(input: { slotId?: DaySlotId; moment?: string | null }) {
    if (input.slotId) {
      board = boardFromSlot(input.slotId, input.moment === undefined ? board.moment : input.moment);
    }
    if (input.moment !== undefined) {
      board = { ...board, moment: input.moment };
    }
    world.board = board;
    return board;
  }

  function getBoard() {
    return board;
  }

  function hostSnapshot() {
    return {
      online: onlineCount(),
      max: MAX_ONLINE,
      waiting: dateQueue.length,
      dates: new Set(dates.values()).size,
      desks: deskOccupancy(),
      zones: zoneOccupancy(),
      board,
      reports: reports.slice(-15),
      kicked: kicked.slice(-20).map((k) => ({
        identity: k.identity,
        name: k.name,
        at: k.at,
      })),
      players: listOnline().map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        study: p.program,
        status: p.status,
        sittingDeskId: p.sittingDeskId,
        isBot: p.isBot,
      })),
      bots: listOnline().filter((p) => p.isBot).length,
    };
  }

  function removeUser(userId: string, reason: "kick" | "leave" = "leave") {
    const user = get(userId);
    if (!user) return { error: "Deze student is niet (meer) in de tent." };
    const socketId = user.socketId || null;
    const sid = user.sid;
    const name = `${user.firstName} ${user.lastName}`;
    leaveQueue(userId);
    const endedDate = endDate(userId, reason);
    if (reason === "kick") {
      kicked.push({
        identity: identityKey(user.firstName, user.lastName, user.age),
        sid,
        name: `${user.firstName} ${user.lastName}`,
        at: Date.now(),
      });
      persistHost();
    }
    users.delete(userId);
    sessions.delete(sid);
    avatars.delete(userId);
    sockets.delete(userId);
    for (const key of [...dms.keys()]) {
      const [left, right] = key.split(":");
      if (left === userId || right === userId) dms.delete(key);
    }
    return { socketId, name, endedDate, id: userId };
  }

  function kick(userId: string) {
    return removeUser(userId, "kick");
  }

  function logout(sid: string | undefined) {
    const user = getBySid(sid);
    if (!user) return null;
    return removeUser(user.id, "leave");
  }

  function identityKey(firstName: string, lastName: string, age: number) {
    return `${firstName.normalize("NFC").toLowerCase()}|${lastName.normalize("NFC").toLowerCase()}|${age}`;
  }

  function chatHistoryFor(userId: string) {
    return chat.filter((m) => m.scope === "tent" && !isBlocked(userId, m.from)).slice(-40);
  }

  function join(input: {
    sid?: string;
    firstName: string;
    lastName: string;
    age: number;
    school: string;
    program: string;
    deskId: number;
    avatar: AvatarInput;
    deskStyle?: DeskStyle;
    isBot?: boolean;
  }): { user: User } | { error: string } {
    if (!input.isBot && (isKickedSid(input.sid) || isKickedIdentity(identityKey(input.firstName, input.lastName, input.age)))) {
      return { error: "Je bent uit de tent gezet. Vraag de host als dat een vergissing was." };
    }
    let user = input.sid ? getBySid(input.sid) : null;
    if (!user && onlineCount() >= MAX_ONLINE) {
      return { error: `De tent zit vol (${MAX_ONLINE} studenten). Probeer zo dadelijk opnieuw.` };
    }

    const desk = deskById(world, input.deskId);
    if (!desk) return { error: "Dit bureau bestaat niet." };
    if (!occupyDesk(desk.id, user?.id || "")) {
      return { error: `Bureau ${desk.id} is al bezet. Kies het nummer van jouw tafel.` };
    }

    const style = parseDeskStyle(input.deskStyle ?? desk.style);

    if (!user) {
      user = {
        id: crypto.randomUUID(),
        sid: input.sid || crypto.randomUUID(),
        firstName: input.firstName,
        lastName: input.lastName,
        color: shirtColor(`${input.firstName}${input.lastName}`),
        x: desk.seatX,
        y: desk.seatY,
        facing: 1,
        moving: false,
        sittingDeskId: desk.id,
        sittingSpotId: null,
        homeDeskId: desk.id,
        age: input.age,
        school: input.school,
        program: input.program,
        status: "studeren",
        statusText: "",
        pauseUntil: 0,
        typing: false,
        draft: "",
        bubble: "",
        bubbleUntil: 0,
        lastChatAt: 0,
        lastShoutAt: 0,
        online: false,
        lastMoveAt: Date.now(),
        createdAt: Date.now(),
        avatarVersion: 1,
        avatarUrl: "",
        preset: null,
        mime: "",
        present: false,
        talkCircleId: null,
        dateTableId: null,
        studyUntil: Date.now() + studyDurationMs(DEFAULT_STUDY_MINUTES),
        lastStudyMinutes: DEFAULT_STUDY_MINUTES,
        waving: "",
        waveUntil: 0,
        lastWaveAt: 0,
        blocked: new Set<string>(),
        deskStyle: style,
        isBot: Boolean(input.isBot),
      };
      users.set(user.id, user);
      sessions.set(user.sid, user.id);
    } else {
      user.firstName = input.firstName;
      user.lastName = input.lastName;
      user.color = shirtColor(`${input.firstName}${input.lastName}`);
      user.age = input.age;
      user.school = input.school;
      user.program = input.program;
      user.homeDeskId = desk.id;
      user.sittingDeskId = desk.id;
      user.sittingSpotId = null;
      user.x = desk.seatX;
      user.y = desk.seatY;
      user.moving = false;
      user.status = "studeren";
      user.talkCircleId = null;
      user.dateTableId = null;
      user.studyUntil = Date.now() + studyDurationMs(DEFAULT_STUDY_MINUTES);
      user.lastStudyMinutes = DEFAULT_STUDY_MINUTES;
      user.deskStyle = style;
    }

    if (input.avatar.kind === "preset") {
      avatars.delete(user.id);
      user.preset = input.avatar.preset;
      user.mime = "image/svg+xml";
      user.avatarVersion += 1;
      user.avatarUrl = `/avatars/${input.avatar.preset}.svg`;
    } else {
      avatars.set(user.id, { buffer: input.avatar.buffer, mime: input.avatar.mime });
      user.preset = null;
      user.mime = input.avatar.mime;
      user.avatarVersion += 1;
      user.avatarUrl = `/media/avatar/${user.id}?v=${user.avatarVersion}`;
    }

    return { user };
  }

  function connect(userId: string, socketId: string) {
    const user = get(userId);
    if (!user) return null;
    const announceJoin = !user.present;
    user.online = true;
    user.present = true;
    user.socketId = socketId;
    user.disconnectedAt = undefined;
    sockets.set(userId, socketId);
    return { user, announceJoin };
  }

  function dropSocket(userId: string, socketId?: string) {
    const user = get(userId);
    if (!user) return { stale: true as const, user: null };
    if (socketId && user.socketId && user.socketId !== socketId) {
      return { stale: true as const, user: null };
    }
    user.online = false;
    user.moving = false;
    user.typing = false;
    user.draft = "";
    user.disconnectedAt = Date.now();
    user.socketId = undefined;
    sockets.delete(userId);
    return { stale: false as const, user };
  }

  function finishDisconnect(userId: string) {
    const user = get(userId);
    if (!user || user.online) return null;
    user.present = false;
    leaveQueue(userId);
    const endedDate = endDate(userId, "disconnect");
    return { user, endedDate };
  }

  function disconnect(userId: string, socketId?: string) {
    const dropped = dropSocket(userId, socketId);
    if (dropped.stale || !dropped.user) return { user: null, endedDate: null, stale: true as const };
    return { ...finishDisconnect(userId), stale: false as const };
  }

  function seated(user: User) {
    return user.sittingDeskId != null || Boolean(user.sittingSpotId);
  }

  function occupySeat(spotId: string, userId: string) {
    for (const user of users.values()) {
      if (user.id === userId) continue;
      if (user.sittingSpotId === spotId && (user.online || user.present)) return false;
    }
    return true;
  }

  function move(userId: string, x: number, y: number, facing: number, moving: boolean) {
    const user = get(userId);
    if (!user || seated(user) || dates.has(userId)) return null;
    const now = Date.now();
    const dt = Math.max(0.016, (now - user.lastMoveAt) / 1000);
    const dist = Math.hypot(x - user.x, y - user.y);
    if (dist > MAX_SPEED * Math.min(dt, 0.35) + 24) return publicUser(user);
    const next = clampMove(world, user.x, user.y, x, y);
    const corrected = Math.hypot(next.x - x, next.y - y) > 2;
    user.x = next.x;
    user.y = next.y;
    user.facing = facing === -1 ? -1 : 1;
    user.moving = Boolean(moving);
    user.lastMoveAt = now;
    pendingMoves.push({
      id: user.id,
      x: user.x,
      y: user.y,
      facing: user.facing,
      moving: user.moving,
      sittingDeskId: null,
      sittingSpotId: null,
      tableId: null,
    });
    return corrected ? publicUser(user) : null;
  }

  function seatTaken(deskId: number, userId: string) {
    for (const user of users.values()) {
      if (user.id === userId) continue;
      if (user.sittingDeskId === deskId && (user.online || user.present)) return true;
    }
    return false;
  }

  function displaceSeat(deskId: number, exceptId: string) {
    const displaced: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (user.id === exceptId) continue;
      if (user.sittingDeskId !== deskId) continue;
      user.sittingDeskId = null;
      displaced.push(publicUser(user));
    }
    return displaced;
  }

  function sit(userId: string, deskId: unknown): { user: PublicPlayer; displaced?: PublicPlayer[] } | { error: string } {
    const user = get(userId);
    const desk = deskById(world, deskId);
    if (!user || !desk) return { error: "Dit bureau bestaat niet." };
    if (dates.has(userId)) return { error: "Je zit nog aan een speeddate-tafel." };
    if (seatTaken(desk.id, user.id)) return { error: "Deze stoel is al bezet." };
    user.sittingDeskId = desk.id;
    user.sittingSpotId = null;
    user.talkCircleId = null;
    user.x = desk.seatX;
    user.y = desk.seatY;
    user.moving = false;
    if (desk.id !== user.homeDeskId && user.status === "studeren") {
      user.status = "pauze";
      user.studyUntil = 0;
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    }
    return { user: publicUser(user) };
  }

  function joinTable(userId: string, tableId: unknown): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    const table = studyTableById(world, tableId);
    if (!user || !table) return { error: "Deze tafel bestaat niet." };
    if (dates.has(userId)) return { error: "Je zit nog aan een speeddate-tafel." };
    const seats = desksOfTable(world, table.id);
    const current = seats.find((d) => d.id === user.sittingDeskId);
    if (current) return { user: publicUser(user) };
    const home = seats.find((d) => d.id === user.homeDeskId && !seatTaken(d.id, user.id));
    const free = home || seats.find((d) => !seatTaken(d.id, user.id));
    if (!free) return { error: "Deze tafel is vol. Probeer een andere." };
    if (user.status === "studeren") {
      user.status = "pauze";
      user.studyUntil = 0;
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    }
    return sit(userId, free.id);
  }

  function leaveTable(userId: string) {
    return stand(userId);
  }

  function sitSpot(userId: string, spotId: unknown): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    const seat = seatById(world, spotId);
    if (!user || !seat) return { error: "Deze plek bestaat niet." };
    if (dates.has(userId)) return { error: "Je zit nog aan een speeddate-tafel." };
    if (!occupySeat(seat.id, user.id)) {
      return { error: seat.kind === "lounge" ? "Deze bank is al bezet." : "Deze kruk is al bezet." };
    }
    user.sittingSpotId = seat.id;
    user.sittingDeskId = null;
    user.x = seat.seatX;
    user.y = seat.seatY;
    user.moving = false;
    if (user.status === "studeren") {
      user.status = "pauze";
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    }
    return { user: publicUser(user) };
  }

  function stand(userId: string) {
    const user = get(userId);
    if (!user) return null;
    if (dates.has(userId)) return publicUser(user);
    user.sittingDeskId = null;
    user.sittingSpotId = null;
    if (user.status === "studeren") {
      user.status = "pauze";
      user.studyUntil = 0;
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    }
    return publicUser(user);
  }

  function setStatus(userId: string, status: unknown, statusText?: unknown, studyMinutes?: unknown) {
    const user = get(userId);
    if (!user) return null;
    const next = validateStatus(status);
    if (statusText !== undefined) {
      user.statusText = validateStatusText(statusText);
    }
    const restartStudy = next === "studeren" && studyMinutes !== undefined;
    if (next === user.status && !restartStudy) return publicUser(user);
    if (next === "studeren" && dates.has(userId)) {
      endDate(userId, "leave");
    }
    user.status = next;
    if (user.status === "studeren") {
      user.pauseUntil = 0;
      user.lastStudyMinutes = parseStudyMinutes(studyMinutes);
      user.studyUntil = Date.now() + studyDurationMs(user.lastStudyMinutes);
      user.talkCircleId = null;
      user.typing = false;
      user.draft = "";
      user.bubble = "";
      user.bubbleUntil = 0;
      const desk = deskById(world, user.homeDeskId);
      if (desk) {
        lastDisplaced = lastDisplaced.concat(displaceSeat(desk.id, user.id));
        user.sittingDeskId = desk.id;
        user.sittingSpotId = null;
        user.x = desk.seatX;
        user.y = desk.seatY;
        user.moving = false;
      }
    } else if (user.status === "pauze") {
      user.studyUntil = 0;
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    } else {
      user.pauseUntil = 0;
      user.studyUntil = 0;
    }
    return publicUser(user);
  }

  function startQuietRound(minutes: unknown): { players: PublicPlayer[]; announce: string; minutes: StudyMinutes } | { error: string } {
    const mins = validateStudyMinutes(minutes);
    if (!mins) return { error: "Kies een ronde van 25 of 50 minuten." };
    const players: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (!user.online) continue;
      if (dates.has(user.id)) continue;
      const pub = setStatus(user.id, "studeren", undefined, mins);
      if (pub) players.push(pub);
    }
    const announce =
      mins === 50
        ? "Iedereen 50 min stil — niet storen tot de pauze."
        : "Iedereen 25 min stil — niet storen tot de pauze.";
    return { players, announce, minutes: mins };
  }

  function nudgePauses(now = Date.now()) {
    const nudged: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (user.status === "pauze" && user.pauseUntil && user.pauseUntil <= now) {
        user.pauseUntil = 0;
        nudged.push(publicUser(user));
      }
    }
    return nudged;
  }

  function extendPause(userId: string) {
    const user = get(userId);
    if (!user) return null;
    user.status = "pauze";
    user.studyUntil = 0;
    user.pauseUntil = Date.now() + PAUSE_MS;
    return publicUser(user);
  }

  function hangOut(userId: string) {
    return setStatus(userId, "kennismaken", "");
  }

  function tickStudyTimers(now = Date.now()) {
    const ended: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (user.status === "studeren" && user.studyUntil && user.studyUntil <= now) {
        const mins: StudyMinutes = user.lastStudyMinutes === 25 ? 25 : 50;
        user.studyUntil = 0;
        user.status = "pauze";
        user.pauseUntil = now + STUDY_PAUSE_MS[mins];
        ended.push(publicUser(user));
      }
    }
    return ended;
  }

  function chatAudience(userId: string): { ids: string[]; scope: ChatScope } {
    const me = get(userId);
    if (!me?.online || isSilent(me)) return { ids: [], scope: "near" };

    const onlineMatching = (pred: (u: User) => boolean) =>
      [...users.values()].filter((u) => u.online && pred(u)).map((u) => u.id);

    if (dates.has(me.id)) {
      const date = dates.get(me.id)!;
      return {
        ids: [date.a, date.b].filter((id) => get(id)?.online && !isBlocked(me.id, id)),
        scope: "date",
      };
    }

    const tableId = socialTableId(me);
    if (tableId) {
      return {
        ids: onlineMatching((u) => socialTableId(u) === tableId && !isSilent(u) && !isBlocked(me.id, u.id)),
        scope: "table",
      };
    }

    if (me.talkCircleId) {
      const cid = me.talkCircleId;
      return {
        ids: onlineMatching((u) => u.talkCircleId === cid && !isSilent(u) && !isBlocked(me.id, u.id)),
        scope: "circle",
      };
    }

    if (inZone(world, me.x, me.y, "coffee")) {
      return {
        ids: onlineMatching((u) => !isSilent(u) && inZone(world, u.x, u.y, "coffee") && !isBlocked(me.id, u.id)),
        scope: "coffee",
      };
    }

    const range = inZone(world, me.x, me.y, "study") ? WHISPER_PROXIMITY : PROXIMITY;
    const ids: string[] = [];
    for (const user of users.values()) {
      if (!user.online) continue;
      if (isSilent(user) && user.id !== me.id) continue;
      if (user.id !== me.id && isBlocked(me.id, user.id)) continue;
      if (user.id === me.id || Math.hypot(user.x - me.x, user.y - me.y) <= range) ids.push(user.id);
    }
    return { ids, scope: "near" };
  }

  function setTyping(userId: string, typing: boolean) {
    const user = get(userId);
    if (!user) return null;
    if (isSilent(user)) {
      user.typing = false;
      user.draft = "";
      return { id: user.id, typing: false, x: user.x, y: user.y };
    }
    user.typing = Boolean(typing);
    user.draft = "";
    return { id: user.id, typing: user.typing, x: user.x, y: user.y };
  }

  function rateLimitChat(user: User, kind: "near" | "tent"): { ok: true } | { error: string } {
    const now = Date.now();
    if (kind === "tent") {
      const wait = SHOUT_COOLDOWN_MS - (now - (user.lastShoutAt || 0));
      if (wait > 0) {
        return { error: `Je mag over ${Math.ceil(wait / 1000)}s opnieuw naar de hele tent roepen.` };
      }
      user.lastShoutAt = now;
      user.lastChatAt = now;
      return { ok: true };
    }
    if (now - (user.lastChatAt || 0) < CHAT_COOLDOWN_MS) return { error: "silent" };
    user.lastChatAt = now;
    return { ok: true };
  }

  function addChat(
    user: User,
    text: string,
    kind: "speak" | "shout" = "speak"
  ): { msg: ChatMessage; ids: string[] } | { error: string } {
    if (isSilent(user)) {
      return {
        error:
          kind === "shout"
            ? "In stille modus roep je niet naar de hele tent."
            : "Je zit in stille modus. Kies Pauze of Kennismaken om te praten.",
      };
    }
    if (kind === "shout") {
      const limited = rateLimitChat(user, "tent");
      if ("error" in limited) return limited;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        from: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        text,
        scope: "tent",
        at: Date.now(),
      };
      chat.push(msg);
      if (chat.length > 120) chat.shift();
      user.typing = false;
      user.draft = "";
      const ids = [...users.values()]
        .filter((u) => u.online && !isSilent(u) && !isBlocked(user.id, u.id))
        .map((u) => u.id);
      return { msg, ids };
    }

    const audience = chatAudience(user.id);
    const limited = rateLimitChat(user, "near");
    if ("error" in limited) return limited;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      from: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      text,
      scope: audience.scope,
      at: Date.now(),
    };
    chat.push(msg);
    if (chat.length > 120) chat.shift();
    user.bubble = text;
    user.bubbleUntil = Date.now() + BUBBLE_MS;
    user.typing = false;
    user.draft = "";
    return { msg, ids: audience.ids };
  }

  function isBlocked(a: string, b: string) {
    if (a === b) return false;
    const ua = get(a);
    const ub = get(b);
    return Boolean(ua?.blocked.has(b) || ub?.blocked.has(a));
  }

  function blockedIdsFor(userId: string) {
    return [...(get(userId)?.blocked || [])];
  }

  function wave(userId: string, emoji: WaveEmoji): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (isSilent(user)) return { error: "Je zit in studeermodus. Kies Pauze of Kennismaken om te zwaaien." };
    const now = Date.now();
    if (now - (user.lastWaveAt || 0) < WAVE_COOLDOWN_MS) {
      return { error: "Even wachten met zwaaien." };
    }
    user.lastWaveAt = now;
    user.waving = emoji;
    user.bubble = emoji;
    user.bubbleUntil = now + WAVE_MS;
    user.waveUntil = now + WAVE_MS;
    return { user: publicUser(user) };
  }

  function sayIce(
    userId: string,
    _source: IceSource,
    otherId?: string
  ): { text: string; user: PublicPlayer; otherId?: string } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (isSilent(user)) return { error: "Je zit in studeermodus. Kies Pauze of Kennismaken voor een ijsbreker." };
    let other: User | null = null;
    if (otherId) {
      other = get(otherId);
      if (!other || other.id === user.id) return { error: "Deze student is niet (meer) in de tent." };
      if (isBlocked(user.id, other.id)) return { error: "Je kunt deze student geen ijsbreker sturen." };
      if (isSilent(other)) return { error: "Die student zit in studeermodus — niet storen." };
    }
    const text = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
    user.bubble = text;
    user.bubbleUntil = Date.now() + BUBBLE_MS;
    user.waving = "";
    return { text, user: publicUser(user), otherId: other?.id };
  }

  function block(userId: string, otherId: string): { blocked: true } | { error: string } {
    const user = get(userId);
    const other = get(otherId);
    if (!user || !other || user.id === other.id) return { error: "Deze student is niet (meer) in de tent." };
    user.blocked.add(otherId);
    leaveQueue(userId);
    leaveQueue(otherId);
    if (dates.has(userId) && dates.get(userId) && [dates.get(userId)!.a, dates.get(userId)!.b].includes(otherId)) {
      endDate(userId, "leave");
    }
    return { blocked: true };
  }

  function unblock(userId: string, otherId: string): { blocked: false } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    user.blocked.delete(otherId);
    return { blocked: false };
  }

  function report(fromId: string, aboutId: string, reason: string): { report: Report } | { error: string } {
    const from = get(fromId);
    const about = get(aboutId);
    if (!from || !about || from.id === about.id) return { error: "Deze student is niet (meer) in de tent." };
    const item: Report = {
      id: crypto.randomUUID(),
      fromId: from.id,
      fromName: `${from.firstName} ${from.lastName}`,
      aboutId: about.id,
      aboutName: `${about.firstName} ${about.lastName}`,
      reason,
      at: Date.now(),
    };
    reports.push(item);
    if (reports.length > 40) reports.shift();
    persistHost();
    return { report: item };
  }

  function unkick(identity: string): { ok: true; name: string } | { error: string } {
    const key = String(identity || "").trim();
    const found = kicked.filter((k) => k.identity === key);
    if (!found.length) return { error: "Deze student staat niet op de kick-lijst." };
    for (let i = kicked.length - 1; i >= 0; i--) {
      if (kicked[i].identity === key) kicked.splice(i, 1);
    }
    persistHost();
    return { ok: true, name: found[0]?.name || "Student" };
  }

  function releaseDesk(deskId: unknown): { ok: true; name: string; id: string } | { error: string } {
    const desk = deskById(world, deskId);
    if (!desk) return { error: "Dit bureau bestaat niet." };
    const now = Date.now();
    const holders = [...users.values()].filter((u) => holdsDesk(u, desk.id, now));
    if (!holders.length) return { error: "Dit bureau is al vrij." };
    const online = holders.find((u) => u.online);
    if (online) {
      return { error: `${online.firstName} is nog in de tent. Zet eruit als dat moet.` };
    }
    const holder = holders[0];
    if (!holder) return { error: "Dit bureau is al vrij." };
    const name = `${holder.firstName} ${holder.lastName}`;
    const id = holder.id;
    const removed = removeUser(id, "leave");
    if (removed && "error" in removed) return { error: removed.error || "Dit bureau is al vrij." };
    return { ok: true, name, id };
  }

  function addDm(from: User, toId: string, text: string): { msg: DirectMessage; to: User; key: string } | { error: string } {
    const to = get(toId);
    if (!to) return { error: "Deze student is niet (meer) in de tent." };
    if (isBlocked(from.id, to.id)) return { error: "Je kunt deze student geen bericht sturen." };
    const now = Date.now();
    if (now - (from.lastChatAt || 0) < CHAT_COOLDOWN_MS) return { error: "silent" };
    from.lastChatAt = now;
    const key = dmKey(from.id, to.id);
    if (!dms.has(key)) dms.set(key, []);
    const msg: DirectMessage = {
      id: crypto.randomUUID(),
      from: from.id,
      to: to.id,
      text,
      at: Date.now(),
    };
    const list = dms.get(key)!;
    list.push(msg);
    if (list.length > 80) list.shift();
    from.typing = false;
    from.draft = "";
    return { msg, to, key };
  }

  function getDms(a: string, b: string) {
    return dms.get(dmKey(a, b)) || [];
  }

  function nearbyIds(userId: string) {
    return chatAudience(userId).ids;
  }

  function assignTalkCircles() {
    const changed: PublicPlayer[] = [];
    const counts = new Map<string, number>();
    for (const circle of world.talkCircles) counts.set(circle.id, 0);

    const eligible: User[] = [];
    for (const user of users.values()) {
      const allowed =
        user.online &&
        !isSilent(user) &&
        !dates.has(user.id) &&
        !user.sittingDeskId &&
        inZone(world, user.x, user.y, "lounge");
      if (!allowed) {
        if (user.talkCircleId) {
          user.talkCircleId = null;
          changed.push(publicUser(user));
        }
        continue;
      }
      eligible.push(user);
    }

    for (const user of eligible) {
      if (!user.talkCircleId) continue;
      const circle = world.talkCircles.find((c) => c.id === user.talkCircleId);
      if (!circle || !inCircle(circle, user.x, user.y, 28)) {
        user.talkCircleId = null;
        changed.push(publicUser(user));
        continue;
      }
      const n = counts.get(circle.id) || 0;
      if (n >= circle.max) {
        user.talkCircleId = null;
        changed.push(publicUser(user));
        continue;
      }
      counts.set(circle.id, n + 1);
    }

    for (const user of eligible) {
      if (user.talkCircleId) continue;
      let best = null as (typeof world.talkCircles)[number] | null;
      let bestD = Infinity;
      for (const circle of world.talkCircles) {
        if ((counts.get(circle.id) || 0) >= circle.max) continue;
        if (!inCircle(circle, user.x, user.y)) continue;
        const d = Math.hypot(user.x - circle.x, user.y - circle.y);
        if (d < bestD) {
          bestD = d;
          best = circle;
        }
      }
      if (best) {
        user.talkCircleId = best.id;
        counts.set(best.id, (counts.get(best.id) || 0) + 1);
        changed.push(publicUser(user));
      }
    }
    return changed;
  }

  function joinQueue(
    userId: string,
    preferSameStudy = false
  ): { queued: boolean; position: number } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (user.status === "studeren") {
      return { error: "Je zit in studeermodus. Kies eerst Pauze of Kennismaken." };
    }
    if (dates.has(userId)) return { error: "Je zit al in een speeddate." };
    const existing = dateQueue.find((q) => q.id === userId);
    if (existing) {
      existing.preferSameStudy = Boolean(preferSameStudy);
      return { queued: true, position: dateQueue.indexOf(existing) + 1 };
    }
    dateQueue.push({ id: userId, queuedAt: Date.now(), preferSameStudy: Boolean(preferSameStudy) });
    return { queued: true, position: dateQueue.length };
  }

  function leaveQueue(userId: string) {
    const idx = dateQueue.findIndex((q) => q.id === userId);
    if (idx >= 0) dateQueue.splice(idx, 1);
  }

  function leaveSpeeddate(userId: string) {
    leaveQueue(userId);
    return endDate(userId, "leave");
  }

  function endDate(userId: string, reason: string) {
    const date = dates.get(userId);
    if (!date) return null;
    dates.delete(date.a);
    dates.delete(date.b);
    const ua = get(date.a);
    const ub = get(date.b);
    if (ua) ua.dateTableId = null;
    if (ub) ub.dateTableId = null;
    if (reason === "timeout" || reason === "decline") {
      dms.delete(dmKey(date.a, date.b));
    }
    return { ...date, reason };
  }

  function getDate(userId: string) {
    return dates.get(userId) || null;
  }

  function freeSpeedTable() {
    const used = new Set<string>();
    for (const date of dates.values()) used.add(date.tableId);
    return world.speedTables.find((t) => !used.has(t.id)) || null;
  }

  function seatAtTable(user: User, table: { id: string; seatAx: number; seatAy: number; seatBx: number; seatBy: number }, slot: "a" | "b") {
    user.sittingDeskId = null;
    user.moving = false;
    user.talkCircleId = null;
    user.dateTableId = table.id;
    user.status = "kennismaken";
    user.pauseUntil = 0;
    user.studyUntil = 0;
    if (slot === "a") {
      user.x = table.seatAx;
      user.y = table.seatAy;
    } else {
      user.x = table.seatBx;
      user.y = table.seatBy;
    }
  }

  function pairScore(
    a: { id: string; queuedAt: number; preferSameStudy: boolean },
    b: { id: string; queuedAt: number; preferSameStudy: boolean },
    ua: User,
    ub: User,
    now: number
  ) {
    const waited = Math.max(now - a.queuedAt, now - b.queuedAt);
    const same = Boolean(ua.program && ub.program && ua.program === ub.program);
    const wantSame = a.preferSameStudy || b.preferSameStudy;
    if (isBlocked(ua.id, ub.id)) return -1;
    if (wantSame && !same && waited < DATE_WAIT_FALLBACK_MS) return -1;
    return (same ? 1000 : 0) + waited / 1000;
  }

  function matchDates(now = Date.now()) {
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (!get(dateQueue[i].id)?.online) dateQueue.splice(i, 1);
    }
    const started: DateMatch[] = [];
    const used = new Set<number>();
    for (let i = 0; i < dateQueue.length; i++) {
      if (used.has(i)) continue;
      const a = dateQueue[i];
      const ua = get(a.id);
      if (!ua?.online) continue;
      let best = -1;
      let bestScore = -1;
      for (let j = i + 1; j < dateQueue.length; j++) {
        if (used.has(j)) continue;
        const b = dateQueue[j];
        const ub = get(b.id);
        if (!ub?.online) continue;
        const score = pairScore(a, b, ua, ub, now);
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
      if (best < 0) continue;
      const table = freeSpeedTable();
      if (!table) break;
      const b = dateQueue[best];
      const partner = get(b.id);
      if (!partner) continue;
      used.add(i);
      used.add(best);
      seatAtTable(ua, table, "a");
      seatAtTable(partner, table, "b");
      const ice = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
      const date: DateMatch = {
        a: a.id,
        b: b.id,
        endsAt: now + DATE_MS,
        ice,
        tableId: table.id,
        tableLabel: table.label,
        phase: "dating",
        yes: {},
      };
      dates.set(a.id, date);
      dates.set(b.id, date);
      started.push(date);
    }
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (used.has(i)) dateQueue.splice(i, 1);
    }
    const ended: DateMatch[] = [];
    const asking: DateMatch[] = [];
    for (const date of new Set(dates.values())) {
      if (date.phase === "dating" && date.endsAt <= now) {
        date.phase = "ask";
        date.continueUntil = now + DATE_CONTINUE_MS;
        asking.push(date);
      } else if (date.phase === "ask" && date.continueUntil && date.continueUntil <= now) {
        const done = endDate(date.a, "timeout");
        if (done) ended.push(done);
      }
    }
    return { started, ended, asking, waiting: dateQueue.length };
  }

  function answerContinue(
    userId: string,
    yes: boolean
  ): { pending: true } | { keep: boolean; done: DateMatch } | { error: string } {
    const date = dates.get(userId);
    if (!date || date.phase !== "ask") return { error: "Geen speeddate om op te antwoorden." };
    date.yes[userId] = yes;
    if (!yes) {
      const done = endDate(userId, "decline");
      if (!done) return { error: "De speeddate is al afgelopen." };
      return { keep: false, done };
    }
    const other = userId === date.a ? date.b : date.a;
    if (date.yes[other] === true) {
      const done = endDate(userId, "keep");
      if (!done) return { error: "De speeddate is al afgelopen." };
      return { keep: true, done };
    }
    return { pending: true };
  }

  function flushMoves() {
    if (!pendingMoves.length) return [];
    const batch = pendingMoves.splice(0, pendingMoves.length);
    const last = new Map<string, PlayerMove>();
    for (const m of batch) last.set(m.id, m);
    return [...last.values()];
  }

  function expireBubbles(now = Date.now()) {
    const expired: string[] = [];
    for (const user of users.values()) {
      if (user.bubble && user.bubbleUntil && user.bubbleUntil < now) {
        user.bubble = "";
        user.bubbleUntil = 0;
        user.waving = "";
        user.waveUntil = 0;
        expired.push(user.id);
      }
    }
    return expired;
  }

  function listOnline() {
    return [...users.values()].filter((u) => u.online).map(publicUser);
  }

  function prune(now = Date.now()) {
    for (const [sid, userId] of sessions) {
      const user = users.get(userId);
      if (!user) {
        sessions.delete(sid);
        continue;
      }
      if (!user.online && user.disconnectedAt && now - user.disconnectedAt > WEEK_MS) {
        users.delete(userId);
        sessions.delete(sid);
        avatars.delete(userId);
      }
    }
  }

  function avatarOf(id: string) {
    return avatars.get(id) || null;
  }

  function chatHistory() {
    return chat.filter((m) => m.scope === "tent").slice(-50);
  }

  function takeDisplaced() {
    const out = lastDisplaced;
    lastDisplaced = [];
    return out;
  }

  function markSimulatedOnline(userId: string) {
    const user = get(userId);
    if (!user) return null;
    user.online = true;
    user.present = true;
    user.isBot = true;
    user.socketId = `bot:${user.id}`;
    user.disconnectedAt = undefined;
    return publicUser(user);
  }

  function botMove(userId: string, x: number, y: number) {
    const user = get(userId);
    if (!user || !user.isBot || dates.has(userId)) return null;
    if (seated(user)) return publicUser(user);
    const next = clampMove(world, user.x, user.y, x, y);
    const facing: 1 | -1 = next.x < user.x - 0.4 ? -1 : next.x > user.x + 0.4 ? 1 : user.facing;
    user.x = next.x;
    user.y = next.y;
    user.facing = facing;
    user.moving = Math.hypot(next.x - x, next.y - y) > 4;
    user.lastMoveAt = Date.now();
    pendingMoves.push({
      id: user.id,
      x: user.x,
      y: user.y,
      facing: user.facing,
      moving: user.moving,
      sittingDeskId: null,
      sittingSpotId: null,
      tableId: null,
    });
    return publicUser(user);
  }

  function listBots() {
    return [...users.values()].filter((u) => u.isBot);
  }

  function clearBots() {
    const removed: string[] = [];
    for (const user of [...users.values()]) {
      if (!user.isBot) continue;
      removeUser(user.id, "leave");
      removed.push(user.id);
    }
    return removed;
  }

  return {
    world,
    join,
    get,
    getBySid,
    connect,
    disconnect,
    move,
    sit,
    sitSpot,
    joinTable,
    leaveTable,
    stand,
    setStatus,
    startQuietRound,
    setTyping,
    addChat,
    addDm,
    getDms,
    joinQueue,
    leaveQueue,
    leaveSpeeddate,
    endDate,
    getDate,
    matchDates,
    flushMoves,
    expireBubbles,
    listOnline,
    onlineCount,
    publicUser,
    avatarOf,
    chatHistory,
    chatHistoryFor,
    nearbyIds,
    chatAudience,
    assignTalkCircles,
    nudgePauses,
    tickStudyTimers,
    extendPause,
    hangOut,
    wave,
    sayIce,
    block,
    unblock,
    report,
    isBlocked,
    blockedIdsFor,
    answerContinue,
    setBoard,
    getBoard,
    zoneOccupancy,
    hostSnapshot,
    kick,
    unkick,
    releaseDesk,
    prune,
    deskOccupancy,
    dropSocket,
    finishDisconnect,
    logout,
    removeUser,
    takeDisplaced,
    markSimulatedOnline,
    botMove,
    listBots,
    clearBots,
  };
}

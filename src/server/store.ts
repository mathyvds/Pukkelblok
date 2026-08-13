import crypto from "node:crypto";
import type {
  ChatMessage,
  DaySlotId,
  DirectMessage,
  IceSource,
  InfoBoard,
  PlayerMove,
  PublicPlayer,
  Report,
  Status,
  WaveEmoji,
  ZoneCount,
} from "../shared/protocol";
import {
  CHAT_COOLDOWN_MS,
  DATE_CONTINUE_MS,
  DATE_WAIT_FALLBACK_MS,
  MAX_ONLINE,
  PAUSE_MS,
  PROXIMITY,
  SHOUT_COOLDOWN_MS,
  WAVE_COOLDOWN_MS,
  WAVE_MS,
} from "../shared/protocol";
import { shirtColor, validateStatus, type AvatarPhoto, type AvatarPreset } from "../shared/validate";
import {
  boardFromSlot,
  clampMove,
  defaultBoard,
  deskById,
  ICEBREAKERS,
  inBox,
  MAX_SPEED,
  talkCircleAt,
  type World,
} from "../shared/world";

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
  sittingTableId: string | null;
  talkCircleId: string | null;
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
  waving: string;
  bubbleUntil: number;
  waveUntil: number;
  lastWaveAt: number;
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
  blocked: Set<string>;
};

type DateMatch = {
  a: string;
  b: string;
  endsAt: number;
  ice: string;
  tableId: string;
  phase: "dating" | "ask";
  continueUntil?: number;
  yes: Record<string, boolean>;
  reason?: string;
};

export function createStore(world: World) {
  const users = new Map<string, User>();
  const sessions = new Map<string, string>();
  const avatars = new Map<string, { buffer: Buffer; mime: string }>();
  const sockets = new Map<string, string>();
  const chat: ChatMessage[] = [];
  const dms = new Map<string, DirectMessage[]>();
  const dateQueue: { id: string; queuedAt: number; preferSameStudy: boolean }[] = [];
  const dates = new Map<string, DateMatch>();
  const pendingMoves: PlayerMove[] = [];
  const kicked = new Set<string>();
  const reports: Report[] = [];
  const tableIce = new Map<string, string>();
  let board: InfoBoard = world.board || defaultBoard();
  world.board = board;

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
      sittingTableId: user.sittingTableId,
      talkCircleId: user.talkCircleId,
      homeDeskId: user.homeDeskId,
      age: user.age,
      school: user.school,
      program: user.program,
      status: user.status,
      statusText: user.statusText,
      pauseUntil: user.pauseUntil || 0,
      typing: user.typing,
      draft: user.draft,
      bubble: user.bubble,
      waving: user.waving,
      inDate: dates.has(user.id),
    };
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
    const ids = ["study", "lounge", "cafe", "speeddate"];
    return ids.map((id) => {
      const zone = world.zones.find((z) => z.id === id);
      let count = 0;
      if (zone) {
        for (const user of users.values()) {
          if (user.online && inBox(zone, user.x, user.y)) count += 1;
        }
      }
      return { id, name: zone?.name || id, count };
    });
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
      players: listOnline().map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        study: p.program,
        school: p.school,
        status: p.status,
        sittingDeskId: p.sittingDeskId,
        talkCircleId: p.talkCircleId,
      })),
    };
  }

  function clearDateSeat(user: User) {
    user.sittingTableId = null;
  }

  function removeUser(userId: string, reason: "kick" | "leave" = "leave") {
    const user = get(userId);
    if (!user) return { error: "Deze student is niet (meer) in de tent." };
    const socketId = user.socketId || null;
    const sid = user.sid;
    const name = `${user.firstName} ${user.lastName}`;
    leaveQueue(userId);
    const endedDate = endDate(userId, reason);
    if (reason === "kick") kicked.add(sid);
    users.delete(userId);
    sessions.delete(sid);
    avatars.delete(userId);
    sockets.delete(userId);
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

  function chatHistoryFor(userId: string) {
    const near = new Set(nearbyIds(userId));
    return chat.filter((m) => m.scope === "tent" || near.has(m.from)).slice(-40);
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
  }): { user: User } | { error: string } {
    if (input.sid && kicked.has(input.sid)) {
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
        sittingTableId: null,
        talkCircleId: null,
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
        waving: "",
        bubbleUntil: 0,
        waveUntil: 0,
        lastWaveAt: 0,
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
        blocked: new Set(),
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
      user.sittingTableId = null;
      user.x = desk.seatX;
      user.y = desk.seatY;
      user.moving = false;
      user.status = "studeren";
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

  function move(userId: string, x: number, y: number, facing: number, moving: boolean) {
    const user = get(userId);
    if (!user) return null;
    if (user.sittingDeskId || user.sittingTableId) {
      if (Math.hypot(x - user.x, y - user.y) > 2) return publicUser(user);
      return null;
    }
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
      sittingTableId: user.sittingTableId,
    });
    return corrected ? publicUser(user) : null;
  }

  function sit(userId: string, deskId: unknown): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    const desk = deskById(world, deskId);
    if (!user || !desk) return { error: "Dit bureau bestaat niet." };
    if (user.sittingTableId) return { error: "Je zit nog aan een speeddate-tafel." };
    if (!occupyDesk(desk.id, user.id)) return { error: "Dit bureau is al bezet." };
    user.sittingDeskId = desk.id;
    user.x = desk.seatX;
    user.y = desk.seatY;
    user.moving = false;
    if (desk.id !== user.homeDeskId && user.status === "studeren") {
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
    if (user.sittingTableId) return publicUser(user);
    user.sittingDeskId = null;
    if (user.status === "studeren") {
      user.status = "pauze";
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    }
    return publicUser(user);
  }

  function setStatus(userId: string, status: unknown, statusText: unknown) {
    const user = get(userId);
    if (!user) return null;
    user.status = validateStatus(status);
    user.statusText = String(statusText || "").trim().slice(0, 60);
    if (user.status === "studeren") {
      user.pauseUntil = 0;
      user.talkCircleId = null;
      if (user.sittingTableId) endDate(userId, "leave");
      leaveQueue(userId);
      const desk = deskById(world, user.homeDeskId);
      if (desk) {
        user.sittingDeskId = desk.id;
        user.sittingTableId = null;
        user.x = desk.seatX;
        user.y = desk.seatY;
        user.moving = false;
      }
    } else if (user.status === "pauze") {
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    } else {
      user.pauseUntil = 0;
    }
    return publicUser(user);
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
    user.pauseUntil = Date.now() + PAUSE_MS;
    return publicUser(user);
  }

  function hangOut(userId: string) {
    return setStatus(userId, "kennismaken", "");
  }

  function setTyping(userId: string, typing: boolean, draft: string) {
    const user = get(userId);
    if (!user) return null;
    user.typing = Boolean(typing);
    user.draft = user.typing ? String(draft || "").slice(0, 80) : "";
    return { id: user.id, typing: user.typing, draft: user.draft, x: user.x, y: user.y };
  }

  function rateLimitChat(user: User, kind: "near" | "tent" | "circle"): { ok: true } | { error: string } {
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
    scope: "near" | "tent" | "circle" = "near"
  ): { msg: ChatMessage } | { error: string } {
    const actual: ChatMessage["scope"] = scope === "tent" ? "tent" : user.talkCircleId ? "circle" : "near";
    const limited = rateLimitChat(user, actual);
    if ("error" in limited) return limited;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      from: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      text,
      scope: actual,
      at: Date.now(),
    };
    chat.push(msg);
    if (chat.length > 120) chat.shift();
    if (actual !== "tent") {
      user.bubble = text;
      user.bubbleUntil = Date.now() + BUBBLE_MS;
      user.waving = "";
    }
    user.typing = false;
    user.draft = "";
    return { msg };
  }

  function isBlocked(a: string, b: string) {
    if (a === b) return false;
    const ua = get(a);
    const ub = get(b);
    return Boolean(ua?.blocked.has(b) || ub?.blocked.has(a));
  }

  function addDm(from: User, toId: string, text: string): { msg: DirectMessage; to: User; key: string } | { error: string } {
    const to = get(toId);
    if (!to) return { error: "Deze student is niet (meer) in de tent." };
    if (isBlocked(from.id, to.id)) return { error: "Je kunt deze student geen bericht sturen." };
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

  function circleMemberIds(circleId: string) {
    const ids: string[] = [];
    for (const user of users.values()) {
      if (user.online && user.talkCircleId === circleId) ids.push(user.id);
    }
    return ids;
  }

  function nearbyIds(userId: string, range = PROXIMITY) {
    const me = get(userId);
    if (!me) return [];
    if (me.talkCircleId) {
      return circleMemberIds(me.talkCircleId).filter((id) => id === me.id || !isBlocked(me.id, id));
    }
    const ids: string[] = [];
    for (const user of users.values()) {
      if (!user.online) continue;
      if (user.id !== me.id && isBlocked(me.id, user.id)) continue;
      if (user.id === me.id || Math.hypot(user.x - me.x, user.y - me.y) <= range) ids.push(user.id);
    }
    return ids;
  }

  function refreshTalkCircles() {
    const changed: PublicPlayer[] = [];
    const rejected: string[] = [];
    const counts = new Map<string, number>();
    const keep = new Set<string>();

    for (const user of users.values()) {
      if (!user.online) {
        if (user.talkCircleId) {
          user.talkCircleId = null;
        }
        continue;
      }
      const canJoin = user.status !== "studeren" && !dates.has(user.id);
      const circle = canJoin ? talkCircleAt(world, user.x, user.y) : null;
      if (user.talkCircleId && circle && circle.id === user.talkCircleId) {
        const n = counts.get(circle.id) || 0;
        if (n < circle.cap) {
          counts.set(circle.id, n + 1);
          keep.add(user.id);
        }
      }
    }

    for (const user of users.values()) {
      if (!user.online) continue;
      if (keep.has(user.id)) continue;
      const prev = user.talkCircleId;
      const canJoin = user.status !== "studeren" && !dates.has(user.id);
      const circle = canJoin ? talkCircleAt(world, user.x, user.y) : null;
      let next: string | null = null;
      if (circle) {
        const n = counts.get(circle.id) || 0;
        if (n < circle.cap) {
          next = circle.id;
          counts.set(circle.id, n + 1);
        } else if (canJoin) {
          rejected.push(user.id);
        }
      }
      if (prev !== next) {
        user.talkCircleId = next;
        changed.push(publicUser(user));
      }
    }
    return { changed, rejected };
  }

  function wave(userId: string, emoji: WaveEmoji): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
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
    source: IceSource,
    _otherId?: string
  ): { text: string; user: PublicPlayer } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    const text = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
    user.bubble = text;
    user.bubbleUntil = Date.now() + BUBBLE_MS;
    user.waving = "";
    return { text, user: publicUser(user) };
  }

  function blockedIdsFor(userId: string) {
    return [...(get(userId)?.blocked || [])];
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

  function report(
    fromId: string,
    aboutId: string,
    reason: string
  ): { report: Report } | { error: string } {
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
    return { report: item };
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

  function getDate(userId: string) {
    return dates.get(userId) || null;
  }

  function usedTables() {
    const used = new Set<string>();
    for (const date of dates.values()) used.add(date.tableId);
    return used;
  }

  function freeTable() {
    const used = usedTables();
    return world.speedTables.find((t) => !used.has(t.id)) || null;
  }

  function endDate(userId: string, reason: string) {
    const date = dates.get(userId);
    if (!date) return null;
    dates.delete(date.a);
    dates.delete(date.b);
    const ua = get(date.a);
    const ub = get(date.b);
    if (ua) clearDateSeat(ua);
    if (ub) clearDateSeat(ub);
    tableIce.delete(date.tableId);
    if (reason === "timeout" || reason === "decline") {
      dms.delete(dmKey(date.a, date.b));
    }
    return { ...date, reason };
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
    if (wantSame && !same && waited < DATE_WAIT_FALLBACK_MS) return -1;
    if (isBlocked(ua.id, ub.id)) return -1;
    return (same ? 1000 : 0) + waited / 1000;
  }

  function seatForDate(user: User, table: (typeof world.speedTables)[number], seat: 0 | 1) {
    user.sittingDeskId = null;
    user.sittingTableId = table.id;
    user.talkCircleId = null;
    user.x = table.seats[seat].x;
    user.y = table.seats[seat].y;
    user.facing = seat === 0 ? 1 : -1;
    user.moving = false;
    user.status = "kennismaken";
    user.pauseUntil = 0;
  }

  function matchDates(now = Date.now()) {
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (!get(dateQueue[i].id)?.online) dateQueue.splice(i, 1);
    }
    const started: DateMatch[] = [];
    const used = new Set<number>();
    for (let i = 0; i < dateQueue.length; i++) {
      if (used.has(i)) continue;
      const table = freeTable();
      if (!table) break;
      const a = dateQueue[i];
      const ua = get(a.id);
      if (!ua?.online || ua.status === "studeren") continue;
      let best = -1;
      let bestScore = -1;
      for (let j = i + 1; j < dateQueue.length; j++) {
        if (used.has(j)) continue;
        const b = dateQueue[j];
        const ub = get(b.id);
        if (!ub?.online || ub.status === "studeren") continue;
        const score = pairScore(a, b, ua, ub, now);
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
      if (best < 0) continue;
      used.add(i);
      used.add(best);
      const b = dateQueue[best];
      const ub = get(b.id)!;
      const ice = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
      seatForDate(ua, table, 0);
      seatForDate(ub, table, 1);
      const date: DateMatch = {
        a: a.id,
        b: b.id,
        endsAt: now + DATE_MS,
        ice,
        tableId: table.id,
        phase: "dating",
        yes: {},
      };
      dates.set(a.id, date);
      dates.set(b.id, date);
      tableIce.set(table.id, ice);
      started.push(date);
    }
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (used.has(i)) dateQueue.splice(i, 1);
    }

    const asking: DateMatch[] = [];
    const ended: DateMatch[] = [];
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
    return { started, asking, ended, waiting: dateQueue.length };
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

  function tableIces() {
    return [...tableIce.entries()].map(([id, ice]) => ({ id, ice }));
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
    return chat.slice(-50);
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
    stand,
    setStatus,
    setTyping,
    addChat,
    addDm,
    getDms,
    joinQueue,
    leaveQueue,
    getDate,
    endDate,
    matchDates,
    answerContinue,
    flushMoves,
    expireBubbles,
    listOnline,
    onlineCount,
    publicUser,
    avatarOf,
    chatHistory,
    chatHistoryFor,
    nearbyIds,
    circleMemberIds,
    refreshTalkCircles,
    wave,
    sayIce,
    block,
    unblock,
    isBlocked,
    report,
    blockedIdsFor,
    nudgePauses,
    extendPause,
    hangOut,
    setBoard,
    getBoard,
    tableIces,
    zoneOccupancy,
    hostSnapshot,
    kick,
    prune,
    deskOccupancy,
    dropSocket,
    finishDisconnect,
    logout,
    removeUser,
  };
}

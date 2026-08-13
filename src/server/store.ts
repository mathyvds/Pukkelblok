import crypto from "node:crypto";
import type {
  ChatMessage,
  ChatScope,
  DirectMessage,
  PlayerMove,
  PublicPlayer,
  Status,
  StudyMinutes,
} from "../shared/protocol";
import {
  CHAT_COOLDOWN_MS,
  DATE_WAIT_FALLBACK_MS,
  DEFAULT_STUDY_MINUTES,
  MAX_ONLINE,
  PAUSE_MS,
  PROXIMITY,
  SHOUT_COOLDOWN_MS,
  STUDY_MINUTES,
  WHISPER_PROXIMITY,
} from "../shared/protocol";
import { shirtColor, validateStatus, type AvatarPhoto, type AvatarPreset } from "../shared/validate";
import { clampMove, deskById, ICEBREAKERS, inCircle, inZone, MAX_SPEED, seatById, type World } from "../shared/world";

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
};

type DateMatch = { a: string; b: string; endsAt: number; ice: string; tableId: string; tableLabel: string; reason?: string };

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
      draft: user.draft,
      bubble: user.bubble,
      inDate: dates.has(user.id),
      talkCircleId: user.talkCircleId,
      dateTableId: user.dateTableId,
      studyUntil: user.studyUntil || 0,
    };
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

  function hostSnapshot() {
    return {
      online: onlineCount(),
      max: MAX_ONLINE,
      waiting: dateQueue.length,
      dates: new Set(dates.values()).size,
      desks: deskOccupancy(),
      players: listOnline().map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        study: p.program,
        status: p.status,
        sittingDeskId: p.sittingDeskId,
      })),
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
    const user = get(userId);
    if (!user || isSilent(user)) return [];
    const { ids } = chatAudience(userId);
    const allow = new Set(ids);
    return chat.filter((m) => m.scope === "tent" || allow.has(m.from)).slice(-40);
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
    });
    return corrected ? publicUser(user) : null;
  }

  function sit(userId: string, deskId: unknown): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    const desk = deskById(world, deskId);
    if (!user || !desk) return { error: "Dit bureau bestaat niet." };
    if (dates.has(userId)) return { error: "Je zit nog aan een speeddate-tafel." };
    if (!occupyDesk(desk.id, user.id)) return { error: "Dit bureau is al bezet." };
    user.sittingDeskId = desk.id;
    user.sittingSpotId = null;
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

  function setStatus(userId: string, status: unknown, statusText: unknown, studyMinutes?: unknown) {
    const user = get(userId);
    if (!user) return null;
    const next = validateStatus(status);
    if (next === "studeren" && dates.has(userId)) {
      endDate(userId, "leave");
    }
    user.status = next;
    user.statusText = String(statusText || "").trim().slice(0, 60);
    if (user.status === "studeren") {
      user.pauseUntil = 0;
      user.studyUntil = Date.now() + studyDurationMs(studyMinutes);
      user.talkCircleId = null;
      const desk = deskById(world, user.homeDeskId);
      if (desk) {
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

  function tickPauses(now = Date.now()) {
    const ended: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (user.status === "pauze" && user.pauseUntil && user.pauseUntil <= now) {
        const pub = setStatus(user.id, "studeren", "");
        if (pub) ended.push(pub);
      }
    }
    return ended;
  }

  function tickStudyTimers(now = Date.now()) {
    const ended: PublicPlayer[] = [];
    for (const user of users.values()) {
      if (user.status === "studeren" && user.studyUntil && user.studyUntil <= now) {
        const pub = setStatus(user.id, "pauze", "");
        if (pub) ended.push(pub);
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
        ids: [date.a, date.b].filter((id) => get(id)?.online),
        scope: "date",
      };
    }

    if (me.talkCircleId) {
      const cid = me.talkCircleId;
      return {
        ids: onlineMatching((u) => u.talkCircleId === cid && !isSilent(u)),
        scope: "circle",
      };
    }

    if (inZone(world, me.x, me.y, "coffee")) {
      return {
        ids: onlineMatching((u) => !isSilent(u) && inZone(world, u.x, u.y, "coffee")),
        scope: "coffee",
      };
    }

    const range = inZone(world, me.x, me.y, "study") ? WHISPER_PROXIMITY : PROXIMITY;
    const ids: string[] = [];
    for (const user of users.values()) {
      if (!user.online) continue;
      if (isSilent(user) && user.id !== me.id) continue;
      if (user.id === me.id || Math.hypot(user.x - me.x, user.y - me.y) <= range) ids.push(user.id);
    }
    return { ids, scope: "near" };
  }

  function setTyping(userId: string, typing: boolean, draft: string) {
    const user = get(userId);
    if (!user) return null;
    if (isSilent(user)) {
      user.typing = false;
      user.draft = "";
      return { id: user.id, typing: false, draft: "", x: user.x, y: user.y };
    }
    user.typing = Boolean(typing);
    user.draft = user.typing ? String(draft || "").slice(0, 80) : "";
    return { id: user.id, typing: user.typing, draft: user.draft, x: user.x, y: user.y };
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
      const ids = [...users.values()].filter((u) => u.online && !isSilent(u)).map((u) => u.id);
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

  function addDm(from: User, toId: string, text: string): { msg: DirectMessage; to: User; key: string } | { error: string } {
    const to = get(toId);
    if (!to) return { error: "Deze student is niet (meer) in de tent." };
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
      };
      dates.set(a.id, date);
      dates.set(b.id, date);
      started.push(date);
    }
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (used.has(i)) dateQueue.splice(i, 1);
    }
    const ended: DateMatch[] = [];
    for (const date of new Set(dates.values())) {
      if (date.endsAt <= now) {
        const done = endDate(date.a, "time");
        if (done) ended.push(done);
      }
    }
    return { started, ended, waiting: dateQueue.length };
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
    sitSpot,
    stand,
    setStatus,
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
    tickPauses,
    tickStudyTimers,
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

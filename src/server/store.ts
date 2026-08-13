import crypto from "node:crypto";
import type { ChatMessage, DirectMessage, PlayerMove, PublicPlayer, Status } from "../shared/protocol";
import { MAX_ONLINE, shirtColor, validateStatus, type AvatarPhoto, type AvatarPreset } from "../shared/validate";
import { clampMove, deskById, ICEBREAKERS, MAX_SPEED, type World } from "../shared/world";

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
  homeDeskId: number;
  age: number;
  school: string;
  program: string;
  status: Status;
  statusText: string;
  typing: boolean;
  draft: string;
  bubble: string;
  bubbleUntil: number;
  online: boolean;
  lastMoveAt: number;
  createdAt: number;
  avatarVersion: number;
  avatarUrl: string;
  preset: number | null;
  mime: string;
  socketId?: string;
  disconnectedAt?: number;
};

type DateMatch = { a: string; b: string; endsAt: number; ice: string; reason?: string };

export function createStore(world: World) {
  const users = new Map<string, User>();
  const sessions = new Map<string, string>();
  const avatars = new Map<string, { buffer: Buffer; mime: string }>();
  const sockets = new Map<string, string>();
  const chat: ChatMessage[] = [];
  const dms = new Map<string, DirectMessage[]>();
  const dateQueue: string[] = [];
  const dates = new Map<string, DateMatch>();
  const pendingMoves: PlayerMove[] = [];

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
      homeDeskId: user.homeDeskId,
      age: user.age,
      school: user.school,
      program: user.program,
      status: user.status,
      statusText: user.statusText,
      typing: user.typing,
      draft: user.draft,
      bubble: user.bubble,
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

  function occupyDesk(deskId: number, userId: string) {
    const now = Date.now();
    for (const user of users.values()) {
      if (user.id === userId) continue;
      if (user.homeDeskId !== deskId && user.sittingDeskId !== deskId) continue;
      if (user.online) return false;
      if (!user.disconnectedAt) return false;
      if (now - user.disconnectedAt < 30_000) return false;
    }
    return true;
  }

  function deskOccupancy() {
    return world.desks.map((desk) => ({
      id: desk.id,
      taken: !occupyDesk(desk.id, ""),
    }));
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
        homeDeskId: desk.id,
        age: input.age,
        school: input.school,
        program: input.program,
        status: "studeren",
        statusText: "",
        typing: false,
        draft: "",
        bubble: "",
        bubbleUntil: 0,
        online: false,
        lastMoveAt: Date.now(),
        createdAt: Date.now(),
        avatarVersion: 1,
        avatarUrl: "",
        preset: null,
        mime: "",
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
    user.online = true;
    user.socketId = socketId;
    user.disconnectedAt = 0;
    sockets.set(userId, socketId);
    return user;
  }

  function disconnect(userId: string) {
    const user = get(userId);
    if (!user) return { user: null, endedDate: null };
    user.online = false;
    user.moving = false;
    user.typing = false;
    user.draft = "";
    user.disconnectedAt = Date.now();
    sockets.delete(userId);
    leaveQueue(userId);
    const endedDate = endDate(userId, "disconnect");
    return { user, endedDate };
  }

  function move(userId: string, x: number, y: number, facing: number, moving: boolean) {
    const user = get(userId);
    if (!user || user.sittingDeskId) return null;
    const now = Date.now();
    const dt = Math.max(0.016, (now - user.lastMoveAt) / 1000);
    const dist = Math.hypot(x - user.x, y - user.y);
    if (dist > MAX_SPEED * Math.min(dt, 0.35) + 24) return publicUser(user);
    const next = clampMove(world, user.x, user.y, x, y);
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
    });
    return null;
  }

  function sit(userId: string, deskId: unknown): { user: PublicPlayer } | { error: string } {
    const user = get(userId);
    const desk = deskById(world, deskId);
    if (!user || !desk) return { error: "Dit bureau bestaat niet." };
    if (!occupyDesk(desk.id, user.id)) return { error: "Dit bureau is al bezet." };
    user.sittingDeskId = desk.id;
    user.x = desk.seatX;
    user.y = desk.seatY;
    user.moving = false;
    return { user: publicUser(user) };
  }

  function stand(userId: string) {
    const user = get(userId);
    if (!user) return null;
    user.sittingDeskId = null;
    if (user.status === "studeren") user.status = "pauze";
    return publicUser(user);
  }

  function setStatus(userId: string, status: unknown, statusText: unknown) {
    const user = get(userId);
    if (!user) return null;
    user.status = validateStatus(status);
    user.statusText = String(statusText || "").trim().slice(0, 60);
    if (user.status === "studeren") {
      const desk = deskById(world, user.homeDeskId);
      if (desk) {
        user.sittingDeskId = desk.id;
        user.x = desk.seatX;
        user.y = desk.seatY;
        user.moving = false;
      }
    }
    return publicUser(user);
  }

  function setTyping(userId: string, typing: boolean, draft: string) {
    const user = get(userId);
    if (!user) return null;
    user.typing = Boolean(typing);
    user.draft = user.typing ? String(draft || "").slice(0, 80) : "";
    return { id: user.id, typing: user.typing, draft: user.draft };
  }

  function addChat(user: User, text: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      from: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      text,
      at: Date.now(),
    };
    chat.push(msg);
    if (chat.length > 80) chat.shift();
    user.bubble = text;
    user.bubbleUntil = Date.now() + BUBBLE_MS;
    user.typing = false;
    user.draft = "";
    return msg;
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
    from.bubble = text;
    from.bubbleUntil = Date.now() + BUBBLE_MS;
    from.typing = false;
    from.draft = "";
    return { msg, to, key };
  }

  function getDms(a: string, b: string) {
    return dms.get(dmKey(a, b)) || [];
  }

  function joinQueue(userId: string): { queued: boolean; position: number } | { error: string } {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (user.status === "studeren") {
      return { error: "Je zit in studeermodus. Kies eerst Pauze of Kennismaken." };
    }
    if (dates.has(userId)) return { error: "Je zit al in een speeddate." };
    if (dateQueue.includes(userId)) return { queued: true, position: dateQueue.indexOf(userId) + 1 };
    dateQueue.push(userId);
    return { queued: true, position: dateQueue.length };
  }

  function leaveQueue(userId: string) {
    const idx = dateQueue.indexOf(userId);
    if (idx >= 0) dateQueue.splice(idx, 1);
  }

  function endDate(userId: string, reason: string) {
    const date = dates.get(userId);
    if (!date) return null;
    dates.delete(date.a);
    dates.delete(date.b);
    return { ...date, reason };
  }

  function matchDates(now = Date.now()) {
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (!get(dateQueue[i])?.online) dateQueue.splice(i, 1);
    }
    const started: DateMatch[] = [];
    while (dateQueue.length >= 2) {
      const a = dateQueue.shift()!;
      const b = dateQueue.shift()!;
      const ua = get(a);
      const ub = get(b);
      if (!ua?.online || !ub?.online) {
        if (ua?.online) dateQueue.unshift(a);
        if (ub?.online) dateQueue.unshift(b);
        break;
      }
      const ice = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
      const date = { a, b, endsAt: now + DATE_MS, ice };
      dates.set(a, date);
      dates.set(b, date);
      started.push(date);
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
    stand,
    setStatus,
    setTyping,
    addChat,
    addDm,
    getDms,
    joinQueue,
    leaveQueue,
    endDate,
    matchDates,
    flushMoves,
    expireBubbles,
    listOnline,
    onlineCount,
    publicUser,
    avatarOf,
    chatHistory,
    prune,
    deskOccupancy,
  };
}

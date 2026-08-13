import crypto from "node:crypto";
import { MAX_ONLINE, shirtColor, validateStatus } from "./validate.js";
import { clampMove, deskById, ICEBREAKERS, MAX_SPEED } from "./world.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BUBBLE_MS = 7000;
const DATE_MS = 3 * 60 * 1000;

export function createStore(world) {
  const users = new Map();
  const sessions = new Map();
  const avatars = new Map();
  const sockets = new Map();
  const chat = [];
  const dms = new Map();
  const dateQueue = [];
  const dates = new Map();
  const pendingMoves = [];

  function publicUser(user) {
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
      status: user.status,
      statusText: user.statusText,
      typing: user.typing,
      draft: user.draft,
      bubble: user.bubble,
      inDate: dates.has(user.id),
    };
  }

  function dmKey(a, b) {
    return [a, b].sort().join(":");
  }

  function get(id) {
    return users.get(id) || null;
  }

  function getBySid(sid) {
    const id = sessions.get(sid);
    return id ? get(id) : null;
  }

  function onlineCount() {
    let n = 0;
    for (const user of users.values()) if (user.online) n += 1;
    return n;
  }

  function occupyDesk(deskId, userId) {
    for (const user of users.values()) {
      if (user.sittingDeskId === deskId && user.id !== userId && user.online) return false;
    }
    return true;
  }

  function join({ sid, firstName, lastName, avatar }) {
    let user = sid ? getBySid(sid) : null;
    if (!user && onlineCount() >= MAX_ONLINE) {
      return { error: `De tent zit vol (${MAX_ONLINE} studenten). Probeer zo dadelijk opnieuw.` };
    }

    if (!user) {
      user = {
        id: crypto.randomUUID(),
        sid: sid || crypto.randomUUID(),
        firstName,
        lastName,
        color: shirtColor(`${firstName}${lastName}`),
        x: world.spawn.x + (Math.random() * 80 - 40),
        y: world.spawn.y + (Math.random() * 40 - 20),
        facing: 1,
        moving: false,
        sittingDeskId: null,
        status: "kennismaken",
        statusText: "",
        typing: false,
        draft: "",
        bubble: "",
        bubbleUntil: 0,
        online: false,
        lastMoveAt: Date.now(),
        createdAt: Date.now(),
        avatarVersion: 1,
      };
      users.set(user.id, user);
      sessions.set(user.sid, user.id);
    } else {
      user.firstName = firstName;
      user.lastName = lastName;
      user.color = shirtColor(`${firstName}${lastName}`);
    }

    if (avatar.kind === "preset") {
      avatars.delete(user.id);
      user.preset = avatar.preset;
      user.mime = "image/svg+xml";
      user.avatarVersion += 1;
      user.avatarUrl = `/avatars/${avatar.preset}.svg`;
    } else {
      avatars.set(user.id, { buffer: avatar.buffer, mime: avatar.mime });
      user.preset = null;
      user.mime = avatar.mime;
      user.avatarVersion += 1;
      user.avatarUrl = `/media/avatar/${user.id}?v=${user.avatarVersion}`;
    }

    return { user };
  }

  function connect(userId, socketId) {
    const user = get(userId);
    if (!user) return null;
    user.online = true;
    user.socketId = socketId;
    user.disconnectedAt = 0;
    sockets.set(userId, socketId);
    return user;
  }

  function disconnect(userId) {
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

  function move(userId, x, y, facing, moving) {
    const user = get(userId);
    if (!user || user.sittingDeskId) return null;
    const now = Date.now();
    const dt = Math.max(0.016, (now - user.lastMoveAt) / 1000);
    const dx = x - user.x;
    const dy = y - user.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_SPEED * Math.min(dt, 0.35) + 24) {
      return publicUser(user);
    }
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

  function sit(userId, deskId) {
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

  function stand(userId) {
    const user = get(userId);
    if (!user) return null;
    user.sittingDeskId = null;
    return publicUser(user);
  }

  function setStatus(userId, status, statusText) {
    const user = get(userId);
    if (!user) return null;
    user.status = validateStatus(status);
    user.statusText = String(statusText || "").trim().slice(0, 60);
    return publicUser(user);
  }

  function setTyping(userId, typing, draft) {
    const user = get(userId);
    if (!user) return null;
    user.typing = Boolean(typing);
    user.draft = user.typing ? String(draft || "").slice(0, 80) : "";
    return { id: user.id, typing: user.typing, draft: user.draft };
  }

  function addChat(user, text) {
    const msg = {
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

  function addDm(from, toId, text) {
    const to = get(toId);
    if (!to) return { error: "Deze student is niet (meer) in de tent." };
    const key = dmKey(from.id, to.id);
    if (!dms.has(key)) dms.set(key, []);
    const msg = {
      id: crypto.randomUUID(),
      from: from.id,
      to: to.id,
      text,
      at: Date.now(),
    };
    const list = dms.get(key);
    list.push(msg);
    if (list.length > 80) list.shift();
    from.bubble = text;
    from.bubbleUntil = Date.now() + BUBBLE_MS;
    from.typing = false;
    from.draft = "";
    return { msg, to, key };
  }

  function getDms(a, b) {
    return dms.get(dmKey(a, b)) || [];
  }

  function joinQueue(userId) {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (dates.has(userId)) return { error: "Je zit al in een speeddate." };
    if (dateQueue.includes(userId)) return { queued: true, position: dateQueue.indexOf(userId) + 1 };
    dateQueue.push(userId);
    return { queued: true, position: dateQueue.length };
  }

  function leaveQueue(userId) {
    const idx = dateQueue.indexOf(userId);
    if (idx >= 0) dateQueue.splice(idx, 1);
  }

  function endDate(userId, reason) {
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
    const started = [];
    while (dateQueue.length >= 2) {
      const a = dateQueue.shift();
      const b = dateQueue.shift();
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
    const ended = [];
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
    const last = new Map();
    for (const m of batch) last.set(m.id, m);
    return [...last.values()];
  }

  function expireBubbles(now = Date.now()) {
    const expired = [];
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

  function avatarOf(id) {
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
  };
}

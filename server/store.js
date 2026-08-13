import crypto from "node:crypto";
import { CHAT_COOLDOWN_MS, MAX_ONLINE, SHOUT_COOLDOWN_MS, shirtColor, validateStatus } from "./validate.js";
import { clampMove, DATE_WAIT_FALLBACK_MS, deskById, ICEBREAKERS, MAX_SPEED, PAUSE_MS, PROXIMITY } from "./world.js";

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
  const kicked = new Set();

  function publicUser(user) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      study: user.study || "",
      avatarUrl: user.avatarUrl,
      color: user.color,
      x: user.x,
      y: user.y,
      facing: user.facing,
      moving: user.moving,
      sittingDeskId: user.sittingDeskId,
      status: user.status,
      statusText: user.statusText,
      pauseUntil: user.pauseUntil || 0,
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

  function join({ sid, firstName, lastName, avatar, study }) {
    if (sid && kicked.has(sid)) {
      return { error: "Je bent uit de tent gezet. Vraag de host als dat een vergissing was." };
    }
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
        study: study || "",
        color: shirtColor(`${firstName}${lastName}`),
        x: world.spawn.x + (Math.random() * 80 - 40),
        y: world.spawn.y + (Math.random() * 40 - 20),
        facing: 1,
        moving: false,
        sittingDeskId: null,
        status: "kennismaken",
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
      };
      users.set(user.id, user);
      sessions.set(user.sid, user.id);
    } else {
      user.firstName = firstName;
      user.lastName = lastName;
      user.study = study || user.study || "";
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
    if (user.status === "pauze") {
      if (!user.pauseUntil || user.pauseUntil < Date.now()) {
        user.pauseUntil = Date.now() + PAUSE_MS;
      }
    } else {
      user.pauseUntil = 0;
    }
    return publicUser(user);
  }

  function tickPauses(now = Date.now()) {
    const ended = [];
    for (const user of users.values()) {
      if (user.status === "pauze" && user.pauseUntil && user.pauseUntil <= now) {
        user.status = "blokken";
        user.pauseUntil = 0;
        ended.push(publicUser(user));
      }
    }
    return ended;
  }

  function setTyping(userId, typing, draft) {
    const user = get(userId);
    if (!user) return null;
    user.typing = Boolean(typing);
    user.draft = user.typing ? String(draft || "").slice(0, 80) : "";
    return { id: user.id, typing: user.typing, draft: user.draft, x: user.x, y: user.y };
  }

  function rateLimitChat(user, kind) {
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
    if (now - (user.lastChatAt || 0) < CHAT_COOLDOWN_MS) {
      return { error: "silent" };
    }
    user.lastChatAt = now;
    return { ok: true };
  }

  function addChat(user, text, scope = "near") {
    const limited = rateLimitChat(user, scope);
    if (limited.error) return { error: limited.error };
    const msg = {
      id: crypto.randomUUID(),
      from: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      text,
      scope,
      at: Date.now(),
    };
    chat.push(msg);
    if (chat.length > 120) chat.shift();
    if (scope === "near") {
      user.bubble = text;
      user.bubbleUntil = Date.now() + BUBBLE_MS;
    }
    user.typing = false;
    user.draft = "";
    return { msg };
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
    from.typing = false;
    from.draft = "";
    return { msg, to, key };
  }

  function getDms(a, b) {
    return dms.get(dmKey(a, b)) || [];
  }

  function nearbyIds(userId, range = PROXIMITY) {
    const me = get(userId);
    if (!me) return [];
    const ids = [];
    for (const user of users.values()) {
      if (!user.online) continue;
      if (user.id === me.id || Math.hypot(user.x - me.x, user.y - me.y) <= range) {
        ids.push(user.id);
      }
    }
    return ids;
  }

  function joinQueue(userId, preferSameStudy = false) {
    const user = get(userId);
    if (!user) return { error: "Niet ingelogd." };
    if (dates.has(userId)) return { error: "Je zit al in een speeddate." };
    const existing = dateQueue.find((q) => q.id === userId);
    if (existing) {
      existing.preferSameStudy = Boolean(preferSameStudy);
      return { queued: true, position: dateQueue.indexOf(existing) + 1 };
    }
    dateQueue.push({ id: userId, queuedAt: Date.now(), preferSameStudy: Boolean(preferSameStudy) });
    return { queued: true, position: dateQueue.length };
  }

  function leaveQueue(userId) {
    const idx = dateQueue.findIndex((q) => q.id === userId);
    if (idx >= 0) dateQueue.splice(idx, 1);
  }

  function endDate(userId, reason) {
    const date = dates.get(userId);
    if (!date) return null;
    dates.delete(date.a);
    dates.delete(date.b);
    return { ...date, reason };
  }

  function pairScore(a, b, ua, ub, now) {
    const waited = Math.max(now - a.queuedAt, now - b.queuedAt);
    const same = Boolean(ua.study && ub.study && ua.study === ub.study);
    const wantSame = a.preferSameStudy || b.preferSameStudy;
    if (wantSame && !same && waited < DATE_WAIT_FALLBACK_MS) return -1;
    return (same ? 1000 : 0) + waited / 1000;
  }

  function matchDates(now = Date.now()) {
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (!get(dateQueue[i].id)?.online) dateQueue.splice(i, 1);
    }
    const started = [];
    const used = new Set();
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
      used.add(i);
      used.add(best);
      const b = dateQueue[best];
      const ice = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
      const date = { a: a.id, b: b.id, endsAt: now + DATE_MS, ice };
      dates.set(a.id, date);
      dates.set(b.id, date);
      started.push(date);
    }
    for (let i = dateQueue.length - 1; i >= 0; i--) {
      if (used.has(i)) dateQueue.splice(i, 1);
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

  function deskOccupancy() {
    return world.desks.map((desk) => {
      const sitter = [...users.values()].find((u) => u.online && u.sittingDeskId === desk.id);
      return {
        id: desk.id,
        taken: Boolean(sitter),
        by: sitter ? `${sitter.firstName} ${sitter.lastName}` : null,
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
        study: p.study,
        status: p.status,
        sittingDeskId: p.sittingDeskId,
      })),
    };
  }

  function kick(userId) {
    const user = get(userId);
    if (!user) return { error: "Deze student is niet (meer) in de tent." };
    const socketId = user.socketId || null;
    const sid = user.sid;
    const name = `${user.firstName} ${user.lastName}`;
    leaveQueue(userId);
    const endedDate = endDate(userId, "kick");
    kicked.add(sid);
    users.delete(userId);
    sessions.delete(sid);
    avatars.delete(userId);
    sockets.delete(userId);
    return { socketId, name, endedDate, id: userId };
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

  function chatHistoryFor(userId) {
    const near = new Set(nearbyIds(userId));
    return chat.filter((m) => m.scope === "tent" || near.has(m.from)).slice(-40);
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
    tickPauses,
    setTyping,
    addChat,
    addDm,
    getDms,
    nearbyIds,
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
    chatHistoryFor,
    hostSnapshot,
    kick,
    prune,
  };
}

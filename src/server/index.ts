import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createWorld, HOST_MOMENT_COPY, onboardText, publicWorld } from "../shared/world";
import { createStore } from "./store";
import {
  MAX_ONLINE,
  parseAvatar,
  validateChat,
  validateNames,
  validateProfile,
  validateReportReason,
  validateWave,
} from "../shared/validate";
import {
  DAY_SLOT_IDS,
  HOST_MOMENTS,
  joinSchema,
  type ClientToServerEvents,
  type DaySlotId,
  type HostMomentId,
  type ServerToClientEvents,
} from "../shared/protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT) || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "blokbar-dev-secret-change-me";
const COOKIE = "blokbar";
const HOST_COOKIE = "blokbar-host";
const HOST_PIN = String(process.env.HOST_PIN || "").trim();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 5_000;
const isProd = process.env.NODE_ENV === "production";

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: false },
  pingInterval: 20000,
  pingTimeout: 20000,
  maxHttpBufferSize: 2e5,
});

const world = createWorld();
const store = createStore(world);
const leaveWait = new Map<string, ReturnType<typeof setTimeout>>();

function cancelLeaveWait(userId: string) {
  const timer = leaveWait.get(userId);
  if (timer) {
    clearTimeout(timer);
    leaveWait.delete(userId);
  }
}

function broadcastLeave(userId: string, endedDate: { a: string; b: string; reason?: string } | null) {
  io.to("tent").emit("player:leave", { id: userId });
  io.to("tent").emit("presence", { online: store.onlineCount(), max: MAX_ONLINE });
  if (endedDate) {
    const other = endedDate.a === userId ? endedDate.b : endedDate.a;
    emitToSocket(other, (id) => io.to(id).emit("speeddate:ended", { reason: endedDate.reason || "disconnect" }));
  }
}

app.set("trust proxy", 1);
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json({ limit: "180kb" }));

function setSessionCookie(res: express.Response, sid: string) {
  res.cookie(COOKIE, sid, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: WEEK_MS,
    path: "/",
  });
}

function setHostCookie(res: express.Response) {
  res.cookie(HOST_COOKIE, "ok", {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: WEEK_MS,
    path: "/",
  });
}

function isHost(req: express.Request) {
  return Boolean(HOST_PIN) && req.signedCookies[HOST_COOKIE] === "ok";
}

function requireHost(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!HOST_PIN) return res.status(503).json({ error: "HOST_PIN is niet ingesteld op de server." });
  if (!isHost(req)) return res.status(401).json({ error: "Niet ingelogd als host." });
  next();
}

function emitToSocket(userId: string, fn: (socketId: string) => void) {
  const target = store.get(userId);
  if (target?.socketId) fn(target.socketId);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Blokbar", festival: "Pukkelpop 2026", online: store.onlineCount(), max: MAX_ONLINE });
});

app.get("/api/desks", (_req, res) => {
  res.json({ desks: store.deskOccupancy().map(({ id, taken }) => ({ id, taken })) });
});

app.get("/api/me", (req, res) => {
  const user = store.getBySid(req.signedCookies[COOKIE]);
  if (!user) return res.status(401).json({ error: "no-session" });
  res.json({ user: store.publicUser(user), online: store.onlineCount(), max: MAX_ONLINE });
});

app.post("/api/join", (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ongeldige gegevens." });
  const names = validateNames(parsed.data.firstName, parsed.data.lastName);
  if ("error" in names) return res.status(400).json({ error: names.error });
  const profile = validateProfile(parsed.data);
  if ("error" in profile) return res.status(400).json({ error: profile.error });
  const avatar = parseAvatar(parsed.data.avatar);
  if ("error" in avatar) return res.status(400).json({ error: avatar.error });

  const result = store.join({
    sid: req.signedCookies[COOKIE],
    firstName: names.firstName,
    lastName: names.lastName,
    age: profile.age,
    school: profile.school,
    program: profile.program,
    deskId: profile.deskId,
    avatar,
  });
  if ("error" in result) return res.status(409).json({ error: result.error });

  setSessionCookie(res, result.user.sid);
  res.json({
    user: store.publicUser(result.user),
    online: store.onlineCount(),
    max: MAX_ONLINE,
  });
});

app.post("/api/logout", (req, res) => {
  const result = store.logout(req.signedCookies[COOKIE]);
  if (result && !("error" in result)) {
    cancelLeaveWait(result.id);
    if (result.socketId) {
      io.sockets.sockets.get(result.socketId)?.disconnect(true);
    }
    broadcastLeave(result.id, result.endedDate);
  }
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/host/status", (req, res) => {
  res.json({ configured: Boolean(HOST_PIN), authed: isHost(req) });
});

app.post("/api/host/login", (req, res) => {
  if (!HOST_PIN) return res.status(503).json({ error: "HOST_PIN is niet ingesteld." });
  const pin = String(req.body?.pin || "").trim();
  if (pin !== HOST_PIN) return res.status(401).json({ error: "Verkeerde host-code." });
  setHostCookie(res);
  res.json({ ok: true, state: store.hostSnapshot() });
});

app.post("/api/host/logout", (_req, res) => {
  res.clearCookie(HOST_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/host/state", requireHost, (_req, res) => {
  res.json(store.hostSnapshot());
});

app.post("/api/host/kick", requireHost, (req, res) => {
  const result = store.kick(String(req.body?.id || ""));
  if ("error" in result) return res.status(404).json({ error: result.error });
  cancelLeaveWait(result.id);
  if (result.socketId) {
    const sock = io.sockets.sockets.get(result.socketId);
    sock?.emit("kicked", { reason: "De host heeft je uit de tent gezet." });
    sock?.disconnect(true);
  }
  broadcastLeave(result.id, result.endedDate);
  io.to("tent").emit("announce", { text: `${result.name} is uit de tent gezet.`, at: Date.now() });
  res.json({ ok: true, state: store.hostSnapshot() });
});

app.post("/api/host/announce", requireHost, (req, res) => {
  const parsed = validateChat(req.body?.text);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  io.to("tent").emit("announce", { text: parsed.text, at: Date.now() });
  res.json({ ok: true });
});

app.post("/api/host/board", requireHost, (req, res) => {
  const slotId = String(req.body?.slotId || "") as DaySlotId;
  if (!DAY_SLOT_IDS.includes(slotId)) return res.status(400).json({ error: "Onbekend moment op de dagkaart." });
  const board = store.setBoard({ slotId });
  io.to("tent").emit("board", board);
  io.to("tent").emit("announce", { text: `${board.title} — ${board.subtitle}`, at: Date.now() });
  res.json({ ok: true, state: store.hostSnapshot() });
});

app.post("/api/host/moment", requireHost, (req, res) => {
  const id = req.body?.id;
  if (id === null || id === "clear") {
    const board = store.setBoard({ moment: null });
    io.to("tent").emit("board", board);
    res.json({ ok: true, state: store.hostSnapshot() });
    return;
  }
  if (!HOST_MOMENTS.includes(id as HostMomentId)) {
    return res.status(400).json({ error: "Onbekend moment." });
  }
  const copy = HOST_MOMENT_COPY[id as HostMomentId];
  const board = store.setBoard({ moment: copy.moment });
  io.to("tent").emit("board", board);
  io.to("tent").emit("announce", { text: copy.announce, at: Date.now() });
  res.json({ ok: true, state: store.hostSnapshot() });
});

app.get("/host", (_req, res) => {
  res.sendFile(path.join(ROOT, "public/host.html"));
});

app.get("/media/avatar/:id", (req, res) => {
  const file = store.avatarOf(req.params.id);
  if (!file) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(file.mime).send(file.buffer);
});

io.use((socket, next) => {
  const raw = socket.request.headers.cookie || "";
  const fakeReq = { headers: { cookie: raw } } as express.Request;
  cookieParser(COOKIE_SECRET)(fakeReq, {} as express.Response, () => {
    const sid = fakeReq.signedCookies?.[COOKIE];
    const user = store.getBySid(sid);
    if (!user) return next(new Error("auth"));
    socket.data.userId = user.id;
    next();
  });
});

io.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  const previous = store.get(userId);
  const prevSocketId = previous?.socketId;
  cancelLeaveWait(userId);
  const connected = store.connect(userId, socket.id);
  if (!connected) {
    socket.disconnect(true);
    return;
  }
  if (prevSocketId && prevSocketId !== socket.id) {
    io.sockets.sockets.get(prevSocketId)?.disconnect(true);
  }
  const { user, announceJoin } = connected;

  socket.join("tent");
  socket.emit("hello", {
    you: store.publicUser(user),
    players: store.listOnline(),
    chat: store.chatHistoryFor(user.id),
    world: publicWorld(world),
    online: store.onlineCount(),
    max: MAX_ONLINE,
    board: store.getBoard(),
    blockedIds: store.blockedIdsFor(user.id),
    tableIces: store.tableIces(),
  });
  if (announceJoin) {
    socket.broadcast.to("tent").emit("player:join", store.publicUser(user));
    socket.emit("notice", { type: "onboard", text: onboardText(user.homeDeskId) });
  } else {
    socket.broadcast.to("tent").emit("player:update", store.publicUser(user));
  }
  io.to("tent").emit("presence", { online: store.onlineCount(), max: MAX_ONLINE });

  socket.on("move", (data) => {
    const correction = store.move(userId, Number(data?.x), Number(data?.y), Number(data?.facing), Boolean(data?.moving));
    if (correction) socket.emit("player:correct", correction);
  });

  socket.on("sit", (deskId) => {
    const result = store.sit(userId, deskId);
    if ("error" in result) {
      socket.emit("notice", { type: "error", text: result.error });
      const me = store.get(userId);
      if (me) socket.emit("player:correct", store.publicUser(me));
      return;
    }
    io.to("tent").emit("player:update", result.user);
  });

  socket.on("sit:spot", (spotId) => {
    const result = store.sitSpot(userId, spotId);
    if ("error" in result) {
      socket.emit("notice", { type: "error", text: result.error });
      const me = store.get(userId);
      if (me) socket.emit("player:correct", store.publicUser(me));
      return;
    }
    io.to("tent").emit("player:update", result.user);
  });

  socket.on("stand", () => {
    const pub = store.stand(userId);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("status", (data) => {
    const dated = store.getDate(userId);
    const pub = store.setStatus(userId, data?.status, data?.statusText, data?.studyMinutes);
    if (pub) io.to("tent").emit("player:update", pub);
    if (dated && !store.getDate(userId)) {
      const other = dated.a === userId ? dated.b : dated.a;
      emitToSocket(userId, (id) => io.to(id).emit("speeddate:ended", { reason: "leave" }));
      emitToSocket(other, (id) => io.to(id).emit("speeddate:ended", { reason: "leave" }));
      const partner = store.get(other);
      if (partner) io.to("tent").emit("player:update", store.publicUser(partner));
    }
  });

  socket.on("pause:extend", () => {
    const pub = store.extendPause(userId);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("pause:hang", () => {
    const pub = store.hangOut(userId);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("wave", (emoji) => {
    const parsed = validateWave(emoji);
    if ("error" in parsed) return socket.emit("notice", { type: "error", text: parsed.error });
    const result = store.wave(userId, parsed.emoji);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    io.to("tent").emit("player:update", result.user);
    io.to("tent").emit("player:wave", { id: userId, emoji: parsed.emoji });
  });

  socket.on("ice:say", (data) => {
    const result = store.sayIce(userId, data?.source === "bar" ? "bar" : "profile", data?.otherId);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    io.to("tent").emit("player:update", result.user);
    const prefix = data?.source === "bar" ? "IJsbreker aan de bar: " : "";
    socket.emit("ice:prompt", { text: result.text, source: data?.source === "bar" ? "bar" : "profile" });
    socket.emit("notice", { type: "ice", text: `${prefix}${result.text}` });
  });

  socket.on("block", (otherId) => {
    const id = String(otherId || "");
    const prevDate = store.getDate(userId);
    const result = store.block(userId, id);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("blocked", { id, blocked: true });
    socket.emit("notice", { type: "blocked", text: "Geblokkeerd. Je ziet elkaars berichten niet meer." });
    if (prevDate && !store.getDate(userId)) {
      for (const uid of [prevDate.a, prevDate.b]) {
        const person = store.get(uid);
        if (person) io.to("tent").emit("player:update", store.publicUser(person));
        emitToSocket(uid, (sid) => io.to(sid).emit("speeddate:ended", { reason: "leave" }));
      }
      io.to("tent").emit("table:ice", { id: prevDate.tableId, ice: null });
    }
  });

  socket.on("unblock", (otherId) => {
    const id = String(otherId || "");
    const result = store.unblock(userId, id);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("blocked", { id, blocked: false });
  });

  socket.on("report", (data) => {
    const reason = validateReportReason(data?.reason);
    if ("error" in reason) return socket.emit("notice", { type: "error", text: reason.error });
    const result = store.report(userId, String(data?.id || ""), reason.reason);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("notice", { type: "report", text: "Melding is bij de host. Dankjewel." });
  });

  socket.on("typing", (data) => {
    const payload = store.setTyping(userId, Boolean(data?.typing), String(data?.draft || ""));
    if (payload) {
      for (const id of store.chatAudience(userId).ids) {
        emitToSocket(id, (sid) => io.to(sid).emit("player:typing", payload));
      }
    }
  });

  socket.on("chat", (text) => {
    const parsed = validateChat(text);
    if ("error" in parsed) return;
    const me = store.get(userId);
    if (!me) return;
    const result = store.addChat(me, parsed.text, "speak");
    if ("error" in result) {
      if (result.error !== "silent") socket.emit("notice", { type: "error", text: result.error });
      return;
    }
    for (const id of result.ids) {
      emitToSocket(id, (sid) => {
        io.to(sid).emit("chat", result.msg);
        io.to(sid).emit("player:update", store.publicUser(me));
      });
    }
  });

  socket.on("shout", (text) => {
    const parsed = validateChat(text);
    if ("error" in parsed) return;
    const me = store.get(userId);
    if (!me) return;
    const result = store.addChat(me, parsed.text, "shout");
    if ("error" in result) {
      socket.emit("notice", { type: "error", text: result.error });
      return;
    }
    for (const id of result.ids) {
      emitToSocket(id, (sid) => io.to(sid).emit("chat", result.msg));
    }
  });

  socket.on("dm:open", (otherId) => {
    const me = store.get(userId);
    const other = store.get(otherId);
    if (!me || !other) return;
    socket.emit("dm:history", { with: otherId, messages: store.getDms(me.id, otherId) });
  });

  socket.on("dm", (data) => {
    const parsed = validateChat(data.text);
    if ("error" in parsed) return;
    const me = store.get(userId);
    if (!me) return;
    const result = store.addDm(me, data.to, parsed.text);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("dm", result.msg);
    const other = store.get(result.to.id);
    if (other?.socketId) io.to(other.socketId).emit("dm", result.msg);
  });

  socket.on("speeddate:join", (data) => {
    const result = store.joinQueue(userId, Boolean(data?.preferSameStudy));
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("speeddate:queued", result);
  });

  socket.on("speeddate:leave", () => {
    const ended = store.leaveSpeeddate(userId);
    socket.emit("speeddate:queued", { queued: false, position: 0 });
    if (ended) {
      const other = ended.a === userId ? ended.b : ended.a;
      emitToSocket(userId, (id) => io.to(id).emit("speeddate:ended", { reason: ended.reason || "leave" }));
      emitToSocket(other, (id) => io.to(id).emit("speeddate:ended", { reason: ended.reason || "leave" }));
      const me = store.get(userId);
      const partner = store.get(other);
      if (me) io.to("tent").emit("player:update", store.publicUser(me));
      if (partner) io.to("tent").emit("player:update", store.publicUser(partner));
    }
  });

  socket.on("speeddate:continue", (data) => {
    const result = store.answerContinue(userId, Boolean(data?.yes));
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    if ("pending" in result) return;
    const reason = result.done.reason || (result.keep ? "keep" : "decline");
    for (const uid of [result.done.a, result.done.b]) {
      const partnerId = uid === result.done.a ? result.done.b : result.done.a;
      emitToSocket(uid, (sid) => {
        io.to(sid).emit("speeddate:continue-result", { keep: result.keep, partnerId });
        io.to(sid).emit("speeddate:ended", { reason });
      });
      const person = store.get(uid);
      if (person) io.to("tent").emit("player:update", store.publicUser(person));
    }
    io.to("tent").emit("table:ice", { id: result.done.tableId, ice: null });
  });

  socket.on("disconnect", () => {
    const dropped = store.dropSocket(userId, socket.id);
    if (dropped.stale || !dropped.user) return;
    cancelLeaveWait(userId);
    const timer = setTimeout(() => {
      leaveWait.delete(userId);
      const done = store.finishDisconnect(userId);
      if (!done) return;
      broadcastLeave(userId, done.endedDate);
    }, RECONNECT_GRACE_MS);
    leaveWait.set(userId, timer);
  });
});

setInterval(() => {
  const moves = store.flushMoves();
  if (moves.length) io.to("tent").emit("players:moves", moves);
}, 50);

setInterval(() => {
  const expired = store.expireBubbles();
  for (const id of expired) io.to("tent").emit("player:bubble-end", { id });
  for (const pub of store.tickPauses()) {
    io.to("tent").emit("player:update", pub);
    emitToSocket(pub.id, (sid) =>
      io.to(sid).emit("notice", {
        type: "pause-nudge",
        text: "Pauze is om. Blijven hangen? Kies Kennismaken, of nog 10 min pauze.",
      })
    );
  }
  for (const pub of store.tickStudyTimers()) {
    io.to("tent").emit("player:update", pub);
    emitToSocket(pub.id, (sid) =>
      io.to(sid).emit("notice", { type: "study-end", text: "Blokronde voorbij — tijd voor een pauze." })
    );
  }
  for (const pub of store.assignTalkCircles()) {
    io.to("tent").emit("player:update", pub);
  }
  const { started, asking, ended, waiting } = store.matchDates();
  for (const date of started) {
    const a = store.get(date.a);
    const b = store.get(date.b);
    if (!a || !b) continue;
    io.to("tent").emit("player:update", store.publicUser(a));
    io.to("tent").emit("player:update", store.publicUser(b));
    io.to("tent").emit("table:ice", { id: date.tableId, ice: date.ice });
    const payloadA = {
      partner: store.publicUser(b),
      endsAt: date.endsAt,
      ice: date.ice,
      waiting,
      tableId: date.tableId,
      tableLabel: date.tableLabel,
    };
    const payloadB = {
      partner: store.publicUser(a),
      endsAt: date.endsAt,
      ice: date.ice,
      waiting,
      tableId: date.tableId,
      tableLabel: date.tableLabel,
    };
    if (a.socketId) io.to(a.socketId).emit("speeddate:matched", payloadA);
    if (b.socketId) io.to(b.socketId).emit("speeddate:matched", payloadB);
  }
  for (const date of asking) {
    const a = store.get(date.a);
    const b = store.get(date.b);
    if (a?.socketId && b) {
      io.to(a.socketId).emit("speeddate:continue-ask", { partner: store.publicUser(b), until: date.continueUntil || Date.now() });
    }
    if (b?.socketId && a) {
      io.to(b.socketId).emit("speeddate:continue-ask", { partner: store.publicUser(a), until: date.continueUntil || Date.now() });
    }
  }
  for (const date of ended) {
    const a = store.get(date.a);
    const b = store.get(date.b);
    if (a) io.to("tent").emit("player:update", store.publicUser(a));
    if (b) io.to("tent").emit("player:update", store.publicUser(b));
    if (a?.socketId) {
      io.to(a.socketId).emit("speeddate:continue-result", { keep: false, partnerId: date.b });
      io.to(a.socketId).emit("speeddate:ended", { reason: date.reason || "timeout" });
    }
    if (b?.socketId) {
      io.to(b.socketId).emit("speeddate:continue-result", { keep: false, partnerId: date.a });
      io.to(b.socketId).emit("speeddate:ended", { reason: date.reason || "timeout" });
    }
    io.to("tent").emit("table:ice", { id: date.tableId, ice: null });
  }
  if (waiting) io.to("tent").emit("speeddate:waiting", { waiting });
}, 1000);

setInterval(() => store.prune(), 60_000);

async function attachFrontend() {
  if (isProd) {
    const dist = path.join(ROOT, "dist");
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/media") || req.path.startsWith("/socket.io")) {
        return next();
      }
      res.sendFile(path.join(dist, "index.html"));
    });
    return;
  }
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

await attachFrontend();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Blokbar (PKP26) op http://localhost:${PORT} (${isProd ? "prod" : "dev"})`);
});

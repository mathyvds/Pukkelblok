import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createWorld, publicWorld } from "./world.js";
import { createStore } from "./store.js";
import {
  MAX_ONLINE,
  parseAvatar,
  validateChat,
  validateNames,
} from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "blokbar-dev-secret-change-me";
const COOKIE = "blokbar";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 20000,
  pingTimeout: 20000,
  maxHttpBufferSize: 2e5,
});

const world = createWorld();
const store = createStore(world);

app.set("trust proxy", 1);
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json({ limit: "180kb" }));
app.use(express.static(path.join(__dirname, "../public"), { maxAge: "1h" }));

function setSessionCookie(res, sid) {
  res.cookie(COOKIE, sid, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: WEEK_MS,
    path: "/",
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "Blokbar",
    online: store.onlineCount(),
    max: MAX_ONLINE,
  });
});

app.get("/api/world", (_req, res) => {
  res.json(publicWorld(world));
});

app.get("/api/me", (req, res) => {
  const user = store.getBySid(req.signedCookies[COOKIE]);
  if (!user) return res.status(401).json({ error: "no-session" });
  res.json({ user: store.publicUser(user), online: store.onlineCount(), max: MAX_ONLINE });
});

app.post("/api/join", (req, res) => {
  const names = validateNames(req.body?.firstName, req.body?.lastName);
  if (names.error) return res.status(400).json({ error: names.error });
  const avatar = parseAvatar(req.body?.avatar);
  if (avatar.error) return res.status(400).json({ error: avatar.error });

  const result = store.join({
    sid: req.signedCookies[COOKIE],
    firstName: names.firstName,
    lastName: names.lastName,
    avatar,
  });
  if (result.error) return res.status(409).json({ error: result.error });

  setSessionCookie(res, result.user.sid);
  res.json({
    user: store.publicUser(result.user),
    online: store.onlineCount(),
    max: MAX_ONLINE,
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/media/avatar/:id", (req, res) => {
  const file = store.avatarOf(req.params.id);
  if (!file) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type(file.mime).send(file.buffer);
});

function emitToUser(userId, event, payload) {
  const target = store.get(userId);
  if (target?.socketId) io.to(target.socketId).emit(event, payload);
}

io.use((socket, next) => {
  const raw = socket.request.headers.cookie || "";
  const fakeReq = { headers: { cookie: raw } };
  cookieParser(COOKIE_SECRET)(fakeReq, {}, () => {
    const sid = fakeReq.signedCookies?.[COOKIE];
    const user = store.getBySid(sid);
    if (!user) return next(new Error("auth"));
    socket.userId = user.id;
    next();
  });
});

io.on("connection", (socket) => {
  const user = store.connect(socket.userId, socket.id);
  if (!user) {
    socket.disconnect(true);
    return;
  }

  socket.join("tent");
  socket.emit("hello", {
    you: store.publicUser(user),
    players: store.listOnline(),
    chat: store.chatHistory(),
    world: publicWorld(world),
    online: store.onlineCount(),
    max: MAX_ONLINE,
  });
  socket.broadcast.to("tent").emit("player:join", store.publicUser(user));
  io.to("tent").emit("presence", { online: store.onlineCount(), max: MAX_ONLINE });

  socket.on("move", (data) => {
    const correction = store.move(
      socket.userId,
      Number(data?.x),
      Number(data?.y),
      Number(data?.facing),
      Boolean(data?.moving)
    );
    if (correction) socket.emit("player:correct", correction);
  });

  socket.on("sit", (deskId) => {
    const result = store.sit(socket.userId, deskId);
    if (result.error) return socket.emit("notice", { type: "error", text: result.error });
    io.to("tent").emit("player:update", result.user);
  });

  socket.on("stand", () => {
    const pub = store.stand(socket.userId);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("status", (data) => {
    const pub = store.setStatus(socket.userId, data?.status, data?.statusText);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("typing", (data) => {
    const payload = store.setTyping(socket.userId, data?.typing, data?.draft);
    if (payload) socket.broadcast.to("tent").emit("player:typing", payload);
  });

  socket.on("chat", (text) => {
    const parsed = validateChat(text);
    if (parsed.error) return;
    const me = store.get(socket.userId);
    const msg = store.addChat(me, parsed.text);
    io.to("tent").emit("chat", msg);
    io.to("tent").emit("player:update", store.publicUser(me));
  });

  socket.on("dm:open", (otherId) => {
    const me = store.get(socket.userId);
    const other = store.get(otherId);
    if (!me || !other) return;
    socket.emit("dm:history", { with: otherId, messages: store.getDms(me.id, otherId) });
  });

  socket.on("dm", (data) => {
    const parsed = validateChat(data?.text);
    if (parsed.error) return;
    const me = store.get(socket.userId);
    const result = store.addDm(me, data?.to, parsed.text);
    if (result.error) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("dm", result.msg);
    emitToUser(result.to.id, "dm", result.msg);
    io.to("tent").emit("player:update", store.publicUser(me));
  });

  socket.on("speeddate:join", () => {
    const result = store.joinQueue(socket.userId);
    if (result.error) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("speeddate:queued", result);
  });

  socket.on("speeddate:leave", () => {
    store.leaveQueue(socket.userId);
    socket.emit("speeddate:queued", { queued: false, position: 0 });
  });

  socket.on("disconnect", () => {
    const { endedDate } = store.disconnect(socket.userId);
    io.to("tent").emit("player:leave", { id: socket.userId });
    io.to("tent").emit("presence", { online: store.onlineCount(), max: MAX_ONLINE });
    if (endedDate) {
      const other = endedDate.a === socket.userId ? endedDate.b : endedDate.a;
      emitToUser(other, "speeddate:ended", { reason: "disconnect" });
    }
  });
});

setInterval(() => {
  const moves = store.flushMoves();
  if (moves.length) io.to("tent").emit("players:moves", moves);
}, 50);

setInterval(() => {
  const expired = store.expireBubbles();
  for (const id of expired) io.to("tent").emit("player:bubble-end", { id });
  const { started, ended, waiting } = store.matchDates();
  for (const date of started) {
    const a = store.get(date.a);
    const b = store.get(date.b);
    const payloadFor = (me, other) => ({
      partner: store.publicUser(other),
      endsAt: date.endsAt,
      ice: date.ice,
      waiting,
    });
    emitToUser(date.a, "speeddate:matched", payloadFor(a, b));
    emitToUser(date.b, "speeddate:matched", payloadFor(b, a));
  }
  for (const date of ended) {
    emitToUser(date.a, "speeddate:ended", { reason: date.reason });
    emitToUser(date.b, "speeddate:ended", { reason: date.reason });
  }
  if (waiting) io.to("tent").emit("speeddate:waiting", { waiting });
}, 1000);

setInterval(() => store.prune(), 60_000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Blokbar luistert op http://localhost:${PORT}`);
});

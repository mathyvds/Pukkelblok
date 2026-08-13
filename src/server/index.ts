import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createWorld, publicWorld } from "../shared/world";
import { createStore } from "./store";
import {
  MAX_ONLINE,
  parseAvatar,
  validateChat,
  validateNames,
} from "../shared/validate";
import { joinSchema, type ClientToServerEvents, type ServerToClientEvents } from "../shared/protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT) || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "blokbar-dev-secret-change-me";
const COOKIE = "blokbar";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Blokbar", festival: "Pukkelpop 2026", online: store.onlineCount(), max: MAX_ONLINE });
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
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ongeldige gegevens." });
  const names = validateNames(parsed.data.firstName, parsed.data.lastName);
  if ("error" in names) return res.status(400).json({ error: names.error });
  const avatar = parseAvatar(parsed.data.avatar);
  if ("error" in avatar) return res.status(400).json({ error: avatar.error });

  const result = store.join({
    sid: req.signedCookies[COOKIE],
    firstName: names.firstName,
    lastName: names.lastName,
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

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
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
  const user = store.connect(userId, socket.id);
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
    const correction = store.move(userId, Number(data?.x), Number(data?.y), Number(data?.facing), Boolean(data?.moving));
    if (correction) socket.emit("player:correct", correction);
  });

  socket.on("sit", (deskId) => {
    const result = store.sit(userId, deskId);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    io.to("tent").emit("player:update", result.user);
  });

  socket.on("stand", () => {
    const pub = store.stand(userId);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("status", (data) => {
    const pub = store.setStatus(userId, data?.status, data?.statusText);
    if (pub) io.to("tent").emit("player:update", pub);
  });

  socket.on("typing", (data) => {
    const payload = store.setTyping(userId, Boolean(data?.typing), String(data?.draft || ""));
    if (payload) socket.broadcast.to("tent").emit("player:typing", payload);
  });

  socket.on("chat", (text) => {
    const parsed = validateChat(text);
    if ("error" in parsed) return;
    const me = store.get(userId);
    if (!me) return;
    const msg = store.addChat(me, parsed.text);
    io.to("tent").emit("chat", msg);
    io.to("tent").emit("player:update", store.publicUser(me));
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
    io.to("tent").emit("player:update", store.publicUser(me));
  });

  socket.on("speeddate:join", () => {
    const result = store.joinQueue(userId);
    if ("error" in result) return socket.emit("notice", { type: "error", text: result.error });
    socket.emit("speeddate:queued", result);
  });

  socket.on("speeddate:leave", () => {
    store.leaveQueue(userId);
    socket.emit("speeddate:queued", { queued: false, position: 0 });
  });

  socket.on("disconnect", () => {
    const { endedDate } = store.disconnect(userId);
    io.to("tent").emit("player:leave", { id: userId });
    io.to("tent").emit("presence", { online: store.onlineCount(), max: MAX_ONLINE });
    if (endedDate) {
      const other = endedDate.a === userId ? endedDate.b : endedDate.a;
      const target = store.get(other);
      if (target?.socketId) io.to(target.socketId).emit("speeddate:ended", { reason: "disconnect" });
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
    if (!a || !b) continue;
    if (a.socketId) {
      io.to(a.socketId).emit("speeddate:matched", { partner: store.publicUser(b), endsAt: date.endsAt, ice: date.ice, waiting });
    }
    if (b.socketId) {
      io.to(b.socketId).emit("speeddate:matched", { partner: store.publicUser(a), endsAt: date.endsAt, ice: date.ice, waiting });
    }
  }
  for (const date of ended) {
    const a = store.get(date.a);
    const b = store.get(date.b);
    if (a?.socketId) io.to(a.socketId).emit("speeddate:ended", { reason: date.reason || "time" });
    if (b?.socketId) io.to(b.socketId).emit("speeddate:ended", { reason: date.reason || "time" });
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

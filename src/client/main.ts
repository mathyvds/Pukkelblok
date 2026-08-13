import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DirectMessage,
  PublicPlayer,
  ServerToClientEvents,
  Status,
} from "../shared/protocol";
import { DESK_COUNT } from "../shared/protocol";
import * as world from "./world";
import { createAmbience } from "./ambience";
import "./styles.css";

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

type Screen = "landing" | "join" | "tent";
type AvatarChoice = { preset: number } | { dataUrl: string };

const screens: Record<Screen, HTMLElement> = {
  landing: $("screen-landing"),
  join: $("screen-join"),
  tent: $("screen-tent"),
};

const ui = {
    first: $("first-name") as HTMLInputElement,
    last: $("last-name") as HTMLInputElement,
    age: $("age") as HTMLInputElement,
    school: $("school") as HTMLSelectElement,
    schoolOther: $("school-other") as HTMLInputElement,
    schoolOtherWrap: $("school-other-wrap"),
    program: $("program") as HTMLInputElement,
    deskId: $("desk-id") as HTMLInputElement,
    deskGrid: $("desk-grid"),
    preview: $("avatar-preview") as HTMLImageElement,
  error: $("join-error"),
  file: $("avatar-file") as HTMLInputElement,
  cam: $("cam") as HTMLVideoElement,
  camActions: $("cam-actions"),
  presets: $("preset-row"),
  chatIn: $("chat-in") as HTMLInputElement,
  chatMsgs: $("chat-msgs"),
  online: $("online-list"),
  dmMsgs: $("dm-msgs"),
  dmIn: $("dm-in") as HTMLInputElement,
  dmWith: $("dm-with"),
  dmThread: $("dm-thread"),
  dmEmpty: $("dm-empty"),
  dmBadge: $("dm-badge"),
  deskHint: $("desk-hint"),
};

const state = {
  me: null as PublicPlayer | null,
  players: new Map<string, PublicPlayer>(),
  avatar: { preset: 1 } as AvatarChoice,
  socket: null as Socket<ServerToClientEvents, ClientToServerEvents> | null,
  touchBound: false,
  dmTarget: null as string | null,
  dmUnread: 0,
  dms: new Map<string, DirectMessage[]>(),
  dateTimer: 0 as number | ReturnType<typeof setInterval>,
  camStream: null as MediaStream | null,
  lastTyping: 0,
};

const ambience = createAmbience();

function show(name: Screen) {
  for (const screen of Object.values(screens)) screen.classList.remove("active");
  screens[name].classList.add("active");
}

function notify(text: string) {
  const el = document.createElement("div");
  el.className = "notif";
  el.textContent = text;
  $("notifs").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fullName(p: PublicPlayer) {
  return `${p.firstName} ${p.lastName}`;
}

function statusLabel(p: PublicPlayer) {
  const map: Record<Status, string> = {
    kennismaken: "Klaar om kennis te maken",
    studeren: "Aan het studeren",
    pauze: "Pauze",
  };
  const base = map[p.status] || "In de tent";
  return p.statusText ? `${base} · ${p.statusText}` : base;
}

function esc(text: string) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

for (let i = 1; i <= 8; i++) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.preset = String(i);
  if (i === 1) btn.classList.add("sel");
  btn.innerHTML = `<img src="/avatars/${i}.svg" alt="Look ${i}"/>`;
  btn.addEventListener("click", () => pickPreset(i));
  ui.presets.appendChild(btn);
}

function pickPreset(n: number) {
  state.avatar = { preset: n };
  ui.preview.src = `/avatars/${n}.svg`;
  [...ui.presets.children].forEach((b) =>
    (b as HTMLElement).classList.toggle("sel", Number((b as HTMLElement).dataset.preset) === n)
  );
  stopCam();
}

function cropToDataUrl(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number }, size = 160) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const w = img.naturalWidth || img.videoWidth || size;
  const h = img.naturalHeight || img.videoHeight || size;
  const s = Math.min(w, h);
  ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.72);
}

ui.file.addEventListener("change", () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const dataUrl = cropToDataUrl(img);
    state.avatar = { dataUrl };
    ui.preview.src = dataUrl;
    [...ui.presets.children].forEach((b) => b.classList.remove("sel"));
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
});

$("btn-camera").addEventListener("click", async () => {
  try {
    state.camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 480, height: 480 },
      audio: false,
    });
    ui.cam.srcObject = state.camStream;
    ui.cam.hidden = false;
    ui.camActions.hidden = false;
    await ui.cam.play();
  } catch {
    ui.error.textContent = "Camera niet beschikbaar. Upload een foto of kies een look.";
  }
});

function stopCam() {
  state.camStream?.getTracks().forEach((t) => t.stop());
  state.camStream = null;
  ui.cam.hidden = true;
  ui.camActions.hidden = true;
}

$("btn-cam-cancel").addEventListener("click", stopCam);
$("btn-snap").addEventListener("click", () => {
  const dataUrl = cropToDataUrl(ui.cam);
  state.avatar = { dataUrl };
  ui.preview.src = dataUrl;
  [...ui.presets.children].forEach((b) => b.classList.remove("sel"));
  stopCam();
});

$("btn-enter").addEventListener("click", () => {
  show("join");
  void loadDesks();
});
$("school").addEventListener("change", () => {
  const other = ui.school.value === "Andere";
  ui.schoolOtherWrap.hidden = !other;
  ui.schoolOther.required = other;
});

async function loadDesks() {
  try {
    const res = await fetch("/api/desks");
    const data = (await res.json()) as { desks: { id: number; taken: boolean }[] };
    const taken = new Set(data.desks.filter((d) => d.taken).map((d) => d.id));
    ui.deskGrid.innerHTML = "";
    for (let i = 1; i <= DESK_COUNT; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(i);
      btn.disabled = taken.has(i);
      btn.title = taken.has(i) ? "Bezet" : `Bureau ${i}`;
      btn.addEventListener("click", () => pickDesk(i));
      ui.deskGrid.appendChild(btn);
    }
  } catch {
    ui.error.textContent = "Kon de bureaus niet laden. Probeer opnieuw.";
  }
}

function pickDesk(id: number) {
  ui.deskId.value = String(id);
  [...ui.deskGrid.children].forEach((b) => b.classList.toggle("sel", b.textContent === String(id)));
}
$("btn-back").addEventListener("click", () => {
  stopCam();
  show("landing");
});

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-join") as HTMLButtonElement;
  if (!Number(ui.deskId.value)) {
    ui.error.textContent = "Kies het nummer van je bureau in de tent.";
    return;
  }
  ui.error.textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
        body: JSON.stringify({
          firstName: ui.first.value,
          lastName: ui.last.value,
          age: Number(ui.age.value),
          school: ui.school.value === "Andere" ? ui.schoolOther.value : ui.school.value,
          program: ui.program.value,
          deskId: Number(ui.deskId.value),
          avatar: state.avatar,
        }),
    });
    const data = (await res.json()) as { user?: PublicPlayer; error?: string };
    if (!res.ok || !data.user) throw new Error(data.error || "Kon niet binnenkomen.");
    enterTent(data.user);
  } catch (err) {
    ui.error.textContent = err instanceof Error ? err.message : "Kon niet binnenkomen.";
  } finally {
    btn.disabled = false;
  }
});

async function restore() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as { user: PublicPlayer };
    enterTent(data.user);
  } catch {
    /* gast zonder cookie blijft op landing */
  }
}

function enterTent(user: PublicPlayer) {
  stopCam();
  state.me = user;
  show("tent");
  $("me-name").textContent = user.firstName;
  ($("me-face") as HTMLImageElement).src = user.avatarUrl;
  ($("status-select") as HTMLSelectElement).value = user.status || "studeren";
  ui.deskHint.textContent = world.myPlaceHint() || (user.homeDeskId ? `Stilte · jouw bureau ${user.homeDeskId}` : "");
  syncPauseClock(user);
  syncStudyClock(user);
  syncChatPlace();
  world.mount({
    canvas: $("world") as HTMLCanvasElement,
    viewport: $("viewport"),
    layer: $("world-dom"),
    avatarsEl: $("avatars"),
    minimap: $("minimap") as HTMLCanvasElement,
    handlers: {
      onMove: (pos) => state.socket?.emit("move", pos),
      onSit: (deskId) => {
        state.socket?.emit("sit", deskId);
      },
      onSitSpot: (spotId) => {
        state.socket?.emit("sit:spot", spotId);
      },
      onStand: () => {
        state.socket?.emit("stand");
        const select = $("status-select") as HTMLSelectElement;
        if (select.value === "studeren") select.value = "pauze";
        ui.deskHint.textContent = world.myPlaceHint();
        if (state.me) {
          state.me = { ...state.me, status: select.value as Status, sittingDeskId: null, sittingSpotId: null };
          syncStudyClock(state.me);
          syncChatPlace();
        }
      },
      onClickPerson: openProfile,
    },
  });
  connectSocket();
  if (!state.touchBound && window.matchMedia("(pointer: coarse)").matches) {
    state.touchBound = true;
    $("touch-pad").hidden = false;
    $("touch-pad").querySelectorAll("button").forEach((btn) => {
      const dir = (btn as HTMLElement).dataset.dir as "up" | "down" | "left" | "right";
      btn.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        world.setTouch(dir, true);
      });
      btn.addEventListener("pointerup", () => world.setTouch(dir, false));
      btn.addEventListener("pointerleave", () => world.setTouch(dir, false));
    });
  }
}

function connectSocket() {
  state.socket?.removeAllListeners();
  state.socket?.disconnect();
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
    transports: ["websocket", "polling"],
  });
  state.socket = socket;

  socket.on("hello", (payload) => {
    world.setWorld(payload.world);
    world.setMe(payload.you.id);
    state.me = payload.you;
    state.players.clear();
    for (const p of payload.players) {
      state.players.set(p.id, p);
      world.upsert(p);
    }
    $("online-count").textContent = String(payload.online);
    $("max-count").textContent = String(payload.max);
    ui.chatMsgs.innerHTML = "";
    payload.chat.forEach(addChatLine);
    renderOnline();
    notify(`Welkom in de Blokbar, ${payload.you.firstName}. De tent staat — morgen begint PKP.`);
    syncPauseClock(payload.you);
    syncStudyClock(payload.you);
    syncChatPlace();
  });

  socket.on("presence", (p) => {
    $("online-count").textContent = String(p.online);
    $("max-count").textContent = String(p.max);
  });
  socket.on("player:join", (p) => {
    const existed = state.players.has(p.id);
    state.players.set(p.id, p);
    world.upsert(p);
    renderOnline();
    if (!existed) notify(`${p.firstName} komt de tent binnen.`);
  });
  socket.on("player:leave", ({ id }) => {
    const left = state.players.get(id);
    if (!left) return;
    state.players.delete(id);
    world.remove(id);
    renderOnline();
    if (id !== state.me?.id) notify(`${left.firstName} verlaat de tent.`);
  });
  socket.on("player:update", (p) => {
    const merged = { ...(state.players.get(p.id) || p), ...p };
    state.players.set(p.id, merged);
    world.upsert(merged);
    if (p.id === state.me?.id) {
      state.me = merged;
      ui.deskHint.textContent = world.myPlaceHint();
      ($("status-select") as HTMLSelectElement).value = merged.status;
      syncPauseClock(merged);
      syncStudyClock(merged);
      syncChatPlace();
    }
    renderOnline();
  });
  socket.on("player:correct", (p) => {
    const merged = { ...(state.players.get(p.id) || p), ...p };
    state.players.set(p.id, merged);
    world.upsert(merged);
    if (p.id === state.me?.id) {
      state.me = merged;
      ui.deskHint.textContent = world.myPlaceHint();
    }
  });
  socket.on("players:moves", (moves) => world.applyMoves(moves));
  socket.on("player:typing", (p) => {
    const prev = state.players.get(p.id);
    if (!prev) return;
    const merged = { ...prev, ...p };
    state.players.set(p.id, merged);
    world.upsert(merged);
  });
  socket.on("player:bubble-end", ({ id }) => {
    const prev = state.players.get(id);
    if (!prev) return;
    const merged = { ...prev, bubble: "" };
    state.players.set(id, merged);
    world.upsert(merged);
  });
  socket.on("chat", addChatLine);
  socket.on("dm", onDm);
  socket.on("dm:history", ({ with: otherId, messages }) => {
    state.dms.set(otherId, messages);
    if (state.dmTarget === otherId) renderDm();
  });
  socket.on("notice", (n) => {
    notify(n.text);
    if (n.type === "pause-end") {
      ($("status-select") as HTMLSelectElement).value = "studeren";
      if (state.me) syncPauseClock({ ...state.me, status: "studeren", pauseUntil: 0 });
    }
    if (n.type === "study-end") {
      ($("status-select") as HTMLSelectElement).value = "pauze";
      if (state.me) syncStudyClock({ ...state.me, status: "pauze", studyUntil: 0 });
    }
  });
  socket.on("announce", (a) => showAnnounce(a.text));
  socket.on("kicked", (k) => {
    notify(k.reason || "Je bent uit de tent gezet.");
    setTimeout(() => location.reload(), 1200);
  });
  socket.on("speeddate:queued", (q) => {
    $("date-copy").textContent = q.queued
      ? `Je staat in de rij (${q.position}). We koppelen je zodra er iemand klaar is.`
      : "Niet meer in de rij.";
    $("date-join").hidden = q.queued;
    $("date-leave").hidden = !q.queued;
  });
  socket.on("speeddate:matched", (payload) => {
    $("modal-date").classList.remove("open");
    $("date-hud").hidden = false;
    $("date-hud-title").textContent = `${payload.tableLabel} · ${payload.partner.firstName}`;
    $("date-hud-ice").textContent = payload.ice;
    tickDate(payload.endsAt);
    notify(`Speeddate aan ${payload.tableLabel} met ${payload.partner.firstName}.`);
    syncChatPlace();
  });
  socket.on("speeddate:ended", (payload) => {
    const reasons: Record<string, string> = {
      time: "De drie minuten zijn om. Je mag aan tafel verder praten.",
      disconnect: "Je date is even weg. Je mag verder chatten via berichten.",
      kick: "Je date is de tent uit.",
      leave: "De speeddate is gestopt.",
    };
    $("date-copy").textContent = reasons[payload.reason] || reasons.time;
    $("date-timer").hidden = true;
    $("date-ice").hidden = true;
    $("date-join").hidden = false;
    $("date-leave").hidden = true;
    $("date-hud").hidden = true;
    clearInterval(state.dateTimer);
    notify(reasons[payload.reason] || reasons.time);
    syncChatPlace();
  });
  socket.on("connect_error", () => {
    notify("Sessie verlopen. Maak opnieuw een gastaccount.");
    show("join");
    void loadDesks();
  });
}

function addChatLine(msg: { from: string; firstName: string; text: string; at: number; scope?: string }) {
  const mine = msg.from === state.me?.id;
  const el = document.createElement("div");
  el.className = "chat-msg" + (mine ? " me" : "");
  const time = new Date(msg.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
  const scopeLabels: Record<string, string> = {
    tent: "hele tent",
    circle: "cirkel",
    coffee: "koffiehoek",
    date: "tafel",
  };
  const scope = msg.scope && scopeLabels[msg.scope] ? `<span class="msg-scope">${scopeLabels[msg.scope]}</span>` : "";
  el.innerHTML = `<div class="msg-head"><span class="msg-name">${esc(msg.firstName)}</span>${scope}<span class="msg-time">${time}</span></div><div class="msg-body">${esc(msg.text)}</div>`;
  ui.chatMsgs.appendChild(el);
  ui.chatMsgs.scrollTop = ui.chatMsgs.scrollHeight;
}

function renderOnline() {
  const people = [...state.players.values()].sort((a, b) => a.firstName.localeCompare(b.firstName, "nl"));
  ui.online.innerHTML = people
    .map((p) => {
      const you = p.id === state.me?.id ? " (jij)" : "";
      return `<button class="online-user" data-id="${p.id}">
        <img src="${p.avatarUrl}" alt=""/>
        <span class="u-info"><span class="u-name">${esc(fullName(p))}${you}</span>
          <span class="u-stat">${esc(statusLabel(p))} · bureau ${p.homeDeskId}${p.talkCircleId ? " · cirkel" : ""}${p.inDate ? " · tafel" : ""}</span></span>
      </button>`;
    })
    .join("");
  ui.online.querySelectorAll(".online-user").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (!id || id === state.me?.id) return;
      openProfile(id);
    });
  });
}

function openProfile(id: string) {
  const p = state.players.get(id);
  if (!p) return;
  ($("prof-avi") as HTMLImageElement).src = p.avatarUrl;
  $("prof-name").textContent = fullName(p);
  $("prof-status").textContent = statusLabel(p);
  $("prof-meta").textContent = p.sittingDeskId
    ? `Zit aan bureau ${p.sittingDeskId}`
    : `Bureau ${p.homeDeskId} · loopt rond`;
  $("prof-school").textContent = `${p.age} jaar · ${p.school} · ${p.program}`;
  $("prof-walk").onclick = () => {
    $("modal-profile").classList.remove("open");
    world.walkToPlayer(p.id);
    notify(`Je loopt naar ${p.firstName}.`);
  };
  $("prof-dm").onclick = () => {
    $("modal-profile").classList.remove("open");
    openDm(p.id);
  };
  $("modal-profile").classList.add("open");
}

function openDm(id: string) {
  const p = state.players.get(id);
  if (!p || !state.socket) return;
  state.dmTarget = id;
  switchTab("dm");
  ui.dmEmpty.hidden = true;
  ui.dmThread.hidden = false;
  ui.dmWith.textContent = fullName(p);
  state.socket.emit("dm:open", id);
  renderDm();
}

function renderDm() {
  const list = state.dms.get(state.dmTarget || "") || [];
  ui.dmMsgs.innerHTML = list
    .map((m) => {
      const mine = m.from === state.me?.id;
      return `<div class="chat-msg${mine ? " me" : ""}"><div class="msg-body">${esc(m.text)}</div></div>`;
    })
    .join("");
  ui.dmMsgs.scrollTop = ui.dmMsgs.scrollHeight;
}

function onDm(msg: DirectMessage) {
  const other = msg.from === state.me?.id ? msg.to : msg.from;
  if (!state.dms.has(other)) state.dms.set(other, []);
  state.dms.get(other)!.push(msg);
  if (state.dmTarget === other) renderDm();
  else {
    state.dmUnread += 1;
    ui.dmBadge.hidden = false;
    ui.dmBadge.textContent = String(state.dmUnread);
    const p = state.players.get(other);
    notify(`Nieuw bericht van ${p ? p.firstName : "iemand"}`);
  }
}

function switchTab(name: string) {
  document.querySelectorAll(".ptab").forEach((t) => t.classList.toggle("on", (t as HTMLElement).dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
  if (name === "dm") {
    state.dmUnread = 0;
    ui.dmBadge.hidden = true;
  }
}

document.querySelectorAll(".ptab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab((btn as HTMLElement).dataset.tab || "online"));
});

$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ui.chatIn.value.trim();
  if (!text) return;
  state.socket?.emit("chat", text);
  ui.chatIn.value = "";
  state.socket?.emit("typing", { typing: false, draft: "" });
});

$("chat-shout").addEventListener("click", () => {
  const text = ui.chatIn.value.trim();
  if (!text) {
    notify("Typ eerst een bericht, daarna 📣 voor de hele tent.");
    return;
  }
  state.socket?.emit("shout", text);
  ui.chatIn.value = "";
  state.socket?.emit("typing", { typing: false, draft: "" });
});

ui.chatIn.addEventListener("input", () => {
  if (state.me?.status === "studeren") return;
  const now = Date.now();
  if (now - state.lastTyping < 120) return;
  state.lastTyping = now;
  const typing = ui.chatIn.value.trim().length > 0;
  state.socket?.emit("typing", { typing, draft: ui.chatIn.value });
  const me = state.players.get(state.me?.id || "");
  if (me) {
    me.typing = typing;
    me.draft = typing ? ui.chatIn.value : "";
    world.upsert(me);
  }
});

$("dm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.dmTarget) return;
  const text = ui.dmIn.value.trim();
  if (!text) return;
  state.socket?.emit("dm", { to: state.dmTarget, text });
  ui.dmIn.value = "";
});

$("dm-back").addEventListener("click", () => {
  state.dmTarget = null;
  ui.dmThread.hidden = true;
  ui.dmEmpty.hidden = false;
});

$("status-select").addEventListener("change", () => {
  const status = ($("status-select") as HTMLSelectElement).value as Status;
  state.socket?.emit("status", { status, studyMinutes: status === "studeren" ? 50 : undefined });
  if (status === "studeren" && state.me?.homeDeskId) {
    ui.deskHint.textContent = `Stilte · jouw bureau ${state.me.homeDeskId}`;
  }
  syncChatPlace();
});

document.querySelectorAll("#study-mins button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const minutes = Number((btn as HTMLElement).dataset.mins) === 25 ? 25 : 50;
    ($("status-select") as HTMLSelectElement).value = "studeren";
    state.socket?.emit("status", { status: "studeren", studyMinutes: minutes });
  });
});

$("btn-speeddate").addEventListener("click", () => $("modal-date").classList.add("open"));
$("btn-sound").addEventListener("click", async () => {
  await ambience.toggle();
  const btn = $("btn-sound");
  btn.textContent = ambience.muted ? "Geluid uit" : "Geluid zacht";
  btn.setAttribute("aria-pressed", ambience.muted ? "false" : "true");
  btn.classList.toggle("on", !ambience.muted);
});
$("date-close").addEventListener("click", () => $("modal-date").classList.remove("open"));
$("date-join").addEventListener("click", () =>
  state.socket?.emit("speeddate:join", {
    preferSameStudy: ($("date-same-study") as HTMLInputElement).checked,
  })
);
$("date-leave").addEventListener("click", () => state.socket?.emit("speeddate:leave"));
$("date-hud-leave").addEventListener("click", () => state.socket?.emit("speeddate:leave"));
$("profile-close").addEventListener("click", () => $("modal-profile").classList.remove("open"));

function tickDate(endsAt: number) {
  clearInterval(state.dateTimer);
  const tick = () => {
    const left = Math.max(0, endsAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
    $("date-timer").textContent = `${m}:${s}`;
    $("date-hud-timer").textContent = `${m}:${s}`;
  };
  tick();
  state.dateTimer = setInterval(tick, 250);
}

let pauseClock: ReturnType<typeof setInterval> | 0 = 0;
let studyClock: ReturnType<typeof setInterval> | 0 = 0;

function formatClock(until: number) {
  const left = Math.max(0, until - Date.now());
  const m = Math.floor(left / 60000);
  const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return { left, label: `${m}:${s}` };
}

function syncPauseClock(user: PublicPlayer) {
  clearInterval(pauseClock);
  const el = $("pause-timer");
  if (user.status !== "pauze" || !user.pauseUntil) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const tick = () => {
    const { left, label } = formatClock(user.pauseUntil);
    el.textContent = `Pauze ${label}`;
    if (left <= 0) {
      clearInterval(pauseClock);
      el.hidden = true;
    }
  };
  tick();
  pauseClock = setInterval(tick, 250);
}

function syncStudyClock(user: PublicPlayer) {
  clearInterval(studyClock);
  const el = $("study-timer");
  const mins = $("study-mins");
  const studying = user.status === "studeren";
  mins.hidden = !studying;
  if (!studying || !user.studyUntil) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const tick = () => {
    const { left, label } = formatClock(user.studyUntil);
    el.textContent = `Blok ${label}`;
    if (left <= 0) {
      clearInterval(studyClock);
      el.hidden = true;
    }
  };
  tick();
  studyClock = setInterval(tick, 250);
}

function syncChatPlace() {
  const me = state.me;
  const silent = me?.status === "studeren";
  ui.chatIn.disabled = Boolean(silent);
  $("chat-shout").toggleAttribute("disabled", Boolean(silent));
  if (silent) {
    ui.chatIn.placeholder = "Stille modus — kies Pauze of Kennismaken om te praten";
  } else if (me?.inDate) {
    ui.chatIn.placeholder = "Zeg iets aan je tafel…";
  } else if (me?.talkCircleId) {
    ui.chatIn.placeholder = "Zeg iets in deze cirkel…";
  } else {
    ui.chatIn.placeholder = "Zeg iets tegen wie in de buurt is…";
  }
  if (me) ui.deskHint.textContent = world.myPlaceHint();
}

function showAnnounce(text: string) {
  const banner = $("announce-banner");
  banner.hidden = false;
  banner.textContent = text;
  window.setTimeout(() => {
    banner.hidden = true;
  }, 8000);
}

$("btn-logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

restore();

setInterval(() => {
  if (screens.tent.classList.contains("active") && state.me) syncChatPlace();
}, 800);

(() => {
  const $ = (id) => document.getElementById(id);
  const screens = {
    landing: $("screen-landing"),
    join: $("screen-join"),
    tent: $("screen-tent"),
  };

  const ui = {
    first: $("first-name"),
    last: $("last-name"),
    preview: $("avatar-preview"),
    error: $("join-error"),
    file: $("avatar-file"),
    cam: $("cam"),
    camActions: $("cam-actions"),
    presets: $("preset-row"),
    chatIn: $("chat-in"),
    chatMsgs: $("chat-msgs"),
    online: $("online-list"),
    dmMsgs: $("dm-msgs"),
    dmIn: $("dm-in"),
    dmWith: $("dm-with"),
    dmThread: $("dm-thread"),
    dmEmpty: $("dm-empty"),
    dmBadge: $("dm-badge"),
    deskHint: $("desk-hint"),
    pauseTimer: $("pause-timer"),
    deskSelect: $("desk-select"),
    study: $("study"),
    shout: $("chat-shout"),
    banner: $("announce-banner"),
  };

  const state = {
    me: null,
    players: new Map(),
    avatar: { preset: 1 },
    socket: null,
    dmTarget: null,
    dmUnread: 0,
    dms: new Map(),
    dateTimer: null,
    pauseClock: null,
    camStream: null,
    lastTyping: 0,
    studies: [],
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function notify(text) {
    const el = document.createElement("div");
    el.className = "notif";
    el.textContent = text;
    $("notifs").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function fullName(p) {
    return `${p.firstName} ${p.lastName}`;
  }

  function statusLabel(p) {
    const map = { kennismaken: "Klaar om kennis te maken", blokken: "Aan het blokken", pauze: "Pauze" };
    const base = map[p.status] || "In de tent";
    return p.statusText ? `${base} · ${p.statusText}` : base;
  }

  const STUDIES = [
    "Rechten",
    "Geneeskunde",
    "Psychologie",
    "Economie / TEW",
    "Handelsingenieur",
    "Ingenieurswetenschappen",
    "Informatica",
    "Taal- en letterkunde",
    "Politieke wetenschappen",
    "Onderwijs",
    "Andere",
  ];

  function fillStudies(list) {
    const studies = list?.length ? list : STUDIES;
    state.studies = studies;
    ui.study.innerHTML = `<option value="">Liever niet zeggen</option>` + studies.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  }

  function fillDesks(count = 100) {
    ui.deskSelect.max = String(count);
    ui.deskSelect.placeholder = `1–${count}`;
  }

  fillStudies();
  fillDesks();
  fetch("/api/world")
    .then((r) => r.json())
    .then((w) => {
      if (w.studies) fillStudies(w.studies);
      if (w.desks?.length) fillDesks(w.desks.length);
    })
    .catch(() => {});

  for (let i = 1; i <= 8; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.preset = String(i);
    if (i === 1) btn.classList.add("sel");
    btn.innerHTML = `<img src="/avatars/${i}.svg" alt="Look ${i}"/>`;
    btn.addEventListener("click", () => pickPreset(i));
    ui.presets.appendChild(btn);
  }

  function pickPreset(n) {
    state.avatar = { preset: n };
    ui.preview.src = `/avatars/${n}.svg`;
    [...ui.presets.children].forEach((b) => b.classList.toggle("sel", Number(b.dataset.preset) === n));
    stopCam();
  }

  function cropToDataUrl(img, size = 160) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const s = Math.min(img.naturalWidth || img.videoWidth, img.naturalHeight || img.videoHeight);
    const sx = ((img.naturalWidth || img.videoWidth) - s) / 2;
    const sy = ((img.naturalHeight || img.videoHeight) - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  ui.file.addEventListener("change", async () => {
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

  $("btn-enter").addEventListener("click", () => show("join"));
  $("btn-back").addEventListener("click", () => {
    stopCam();
    show("landing");
  });

  $("join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    ui.error.textContent = "";
    $("btn-join").disabled = true;
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          firstName: ui.first.value,
          lastName: ui.last.value,
          study: ui.study.value,
          avatar: state.avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kon niet binnenkomen.");
      enterTent(data.user);
    } catch (err) {
      ui.error.textContent = err.message;
    } finally {
      $("btn-join").disabled = false;
    }
  });

  async function restore() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      enterTent(data.user);
    } catch {
      /* gast zonder cookie blijft op landing */
    }
  }

  function enterTent(user) {
    stopCam();
    state.me = user;
    show("tent");
    $("me-name").textContent = user.firstName;
    $("me-face").src = user.avatarUrl;
    $("status-select").value = user.status || "kennismaken";
    syncPauseClock(user);
    BlokWorld.mount({
      canvas: $("world"),
      viewport: $("viewport"),
      layer: $("world-dom"),
      avatarsEl: $("avatars"),
      minimap: $("minimap"),
      handlers: {
        onMove: (pos) => state.socket?.emit("move", pos),
        onSit: (deskId) => {
          state.socket?.emit("sit", deskId);
          ui.deskHint.textContent = `Je zit aan bureau ${deskId}`;
        },
        onStand: () => {
          state.socket?.emit("stand");
          ui.deskHint.textContent = "";
        },
        onClickPerson: openProfile,
      },
    });
    connectSocket();
    if (window.matchMedia("(pointer: coarse)").matches) {
      $("touch-pad").hidden = false;
      $("touch-pad").querySelectorAll("button").forEach((btn) => {
        const dir = btn.dataset.dir;
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          BlokWorld.setTouch(dir, true);
        });
        btn.addEventListener("pointerup", () => BlokWorld.setTouch(dir, false));
        btn.addEventListener("pointerleave", () => BlokWorld.setTouch(dir, false));
      });
    }
  }

  function connectSocket() {
    const socket = io({ transports: ["websocket", "polling"] });
    state.socket = socket;

    socket.on("hello", (payload) => {
      BlokWorld.setWorld(payload.world);
      BlokWorld.setMe(payload.you.id);
      state.me = payload.you;
      state.players.clear();
      for (const p of payload.players) {
        state.players.set(p.id, p);
        BlokWorld.upsert(p);
      }
      $("online-count").textContent = payload.online;
      $("max-count").textContent = payload.max;
      ui.chatMsgs.innerHTML = "";
      payload.chat.forEach(addChatLine);
      renderOnline();
      if (payload.studies) fillStudies(payload.studies);
      if (payload.world?.desks?.length) fillDesks(payload.world.desks.length);
      syncPauseClock(payload.you);
      notify(`Welkom in de Blokbar, ${payload.you.firstName}.`);
    });

    socket.on("presence", (p) => {
      $("online-count").textContent = p.online;
      $("max-count").textContent = p.max;
    });
    socket.on("player:join", (p) => {
      state.players.set(p.id, p);
      BlokWorld.upsert(p);
      renderOnline();
      notify(`${p.firstName} komt de tent binnen.`);
    });
    socket.on("player:leave", ({ id }) => {
      const left = state.players.get(id);
      state.players.delete(id);
      BlokWorld.remove(id);
      renderOnline();
      if (left) notify(`${left.firstName} verlaat de tent.`);
    });
    socket.on("player:update", (p) => {
      const prev = state.players.get(p.id) || {};
      const merged = { ...prev, ...p };
      state.players.set(p.id, merged);
      BlokWorld.upsert(merged);
      if (p.id === state.me?.id) {
        state.me = merged;
        if (merged.sittingDeskId) {
          ui.deskHint.textContent = `Je zit aan bureau ${merged.sittingDeskId}`;
          ui.deskSelect.value = String(merged.sittingDeskId);
        } else if (!ui.deskHint.textContent.startsWith("Je zit")) ui.deskHint.textContent = "";
        $("status-select").value = merged.status || $("status-select").value;
        syncPauseClock(merged);
      }
      renderOnline();
    });
    socket.on("player:correct", (p) => BlokWorld.upsert(p));
    socket.on("players:moves", (moves) => BlokWorld.applyMoves(moves));
    socket.on("player:typing", (p) => {
      const prev = state.players.get(p.id);
      if (!prev) return;
      const merged = { ...prev, ...p };
      state.players.set(p.id, merged);
      BlokWorld.upsert(merged);
    });
    socket.on("player:bubble-end", ({ id }) => {
      const prev = state.players.get(id);
      if (!prev) return;
      const merged = { ...prev, bubble: "" };
      state.players.set(id, merged);
      BlokWorld.upsert(merged);
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
        $("status-select").value = "blokken";
        syncPauseClock({ status: "blokken", pauseUntil: 0 });
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
      openDm(payload.partner.id);
      $("date-ice").hidden = false;
      $("date-ice").textContent = `IJsbreker: ${payload.ice}`;
      $("date-timer").hidden = false;
      $("modal-date").classList.add("open");
      $("date-copy").textContent = `Je date met ${fullName(payload.partner)}.`;
      $("date-join").hidden = true;
      $("date-leave").hidden = true;
      tickDate(payload.endsAt);
      notify(`Speeddate met ${payload.partner.firstName}!`);
    });
    socket.on("speeddate:ended", () => {
      $("date-copy").textContent = "De drie minuten zijn om. Je mag verder chatten via berichten.";
      $("date-timer").hidden = true;
      $("date-join").hidden = false;
      clearInterval(state.dateTimer);
    });
    socket.on("connect_error", () => {
      notify("Sessie verlopen. Maak opnieuw een gastaccount.");
      show("join");
    });
  }

  function addChatLine(msg) {
    const mine = msg.from === state.me?.id;
    const el = document.createElement("div");
    el.className = "chat-msg" + (mine ? " me" : "") + (msg.scope === "tent" ? " shout" : "");
    const time = new Date(msg.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
    const scope = msg.scope === "tent" ? `<span class="msg-scope">hele tent</span>` : "";
    el.innerHTML = `<div class="msg-head"><span class="msg-name">${esc(msg.firstName)}</span>${scope}<span class="msg-time">${time}</span></div><div class="msg-body">${esc(msg.text)}</div>`;
    ui.chatMsgs.appendChild(el);
    ui.chatMsgs.scrollTop = ui.chatMsgs.scrollHeight;
  }

  function esc(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function renderOnline() {
    const people = [...state.players.values()].sort((a, b) => a.firstName.localeCompare(b.firstName, "nl"));
    ui.online.innerHTML = people
      .map((p) => {
        const you = p.id === state.me?.id ? " (jij)" : "";
        return `<button class="online-user" data-id="${p.id}">
          <img src="${p.avatarUrl}" alt=""/>
          <span class="u-info"><span class="u-name">${esc(fullName(p))}${you}</span>
          <span class="u-stat">${esc(statusLabel(p))}</span></span>
        </button>`;
      })
      .join("");
    ui.online.querySelectorAll(".online-user").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.id === state.me?.id) return;
        openProfile(btn.dataset.id);
      });
    });
  }

  function openProfile(id) {
    const p = state.players.get(id);
    if (!p) return;
    $("prof-avi").src = p.avatarUrl;
    $("prof-name").textContent = fullName(p);
    $("prof-status").textContent = statusLabel(p);
    $("prof-study").textContent = p.study ? p.study : "Geen vakgebied opgegeven";
    $("prof-meta").textContent = p.sittingDeskId ? `Zit aan bureau ${p.sittingDeskId}` : "Loopt rond in de tent";
    $("prof-dm").onclick = () => {
      $("modal-profile").classList.remove("open");
      openDm(p.id);
    };
    $("modal-profile").classList.add("open");
  }

  function openDm(id) {
    const p = state.players.get(id);
    if (!p) return;
    state.dmTarget = id;
    switchTab("dm");
    ui.dmEmpty.hidden = true;
    ui.dmThread.hidden = false;
    ui.dmWith.textContent = fullName(p);
    state.socket.emit("dm:open", id);
    renderDm();
  }

  function renderDm() {
    const list = state.dms.get(state.dmTarget) || [];
    ui.dmMsgs.innerHTML = list
      .map((m) => {
        const mine = m.from === state.me?.id;
        return `<div class="chat-msg${mine ? " me" : ""}"><div class="msg-body">${esc(m.text)}</div></div>`;
      })
      .join("");
    ui.dmMsgs.scrollTop = ui.dmMsgs.scrollHeight;
  }

  function onDm(msg) {
    const other = msg.from === state.me?.id ? msg.to : msg.from;
    if (!state.dms.has(other)) state.dms.set(other, []);
    state.dms.get(other).push(msg);
    if (state.dmTarget === other) renderDm();
    else {
      state.dmUnread += 1;
      ui.dmBadge.hidden = false;
      ui.dmBadge.textContent = String(state.dmUnread);
      const p = state.players.get(other);
      notify(`Nieuw bericht van ${p ? p.firstName : "iemand"}`);
    }
  }

  function switchTab(name) {
    document.querySelectorAll(".ptab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
    if (name === "dm") {
      state.dmUnread = 0;
      ui.dmBadge.hidden = true;
    }
  }

  document.querySelectorAll(".ptab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ui.chatIn.value.trim();
    if (!text) return;
    state.socket.emit("chat", text);
    ui.chatIn.value = "";
    state.socket.emit("typing", { typing: false, draft: "" });
  });

  ui.shout.addEventListener("click", () => {
    const text = ui.chatIn.value.trim();
    if (!text) {
      notify("Typ eerst een bericht, daarna 📣 voor de hele tent.");
      return;
    }
    state.socket.emit("shout", text);
    ui.chatIn.value = "";
    state.socket.emit("typing", { typing: false, draft: "" });
  });

  ui.chatIn.addEventListener("input", () => {
    const now = Date.now();
    if (now - state.lastTyping < 120) return;
    state.lastTyping = now;
    const typing = ui.chatIn.value.trim().length > 0;
    state.socket.emit("typing", { typing, draft: ui.chatIn.value });
    const me = state.players.get(state.me?.id);
    if (me) {
      me.typing = typing;
      me.draft = typing ? ui.chatIn.value : "";
      BlokWorld.upsert(me);
    }
  });

  $("dm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.dmTarget) return;
    const text = ui.dmIn.value.trim();
    if (!text) return;
    state.socket.emit("dm", { to: state.dmTarget, text });
    ui.dmIn.value = "";
  });

  $("dm-back").addEventListener("click", () => {
    state.dmTarget = null;
    ui.dmThread.hidden = true;
    ui.dmEmpty.hidden = false;
  });

  $("status-select").addEventListener("change", () => {
    state.socket.emit("status", { status: $("status-select").value });
  });

  ui.deskSelect.addEventListener("change", () => {
    const id = Number(ui.deskSelect.value);
    if (!id) return;
    const ok = BlokWorld.goToDesk(id);
    if (!ok) {
      notify("Dat bureau is bezet of bestaat niet.");
      ui.deskSelect.value = state.me?.sittingDeskId ? String(state.me.sittingDeskId) : "";
      return;
    }
    ui.deskHint.textContent = `Je zit aan bureau ${id}`;
  });
  ui.deskSelect.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.deskSelect.dispatchEvent(new Event("change"));
    }
  });

  $("btn-speeddate").addEventListener("click", () => $("modal-date").classList.add("open"));
  $("date-close").addEventListener("click", () => $("modal-date").classList.remove("open"));
  $("date-join").addEventListener("click", () =>
    state.socket.emit("speeddate:join", { preferSameStudy: $("date-same-study").checked })
  );
  $("date-leave").addEventListener("click", () => state.socket.emit("speeddate:leave"));
  $("profile-close").addEventListener("click", () => $("modal-profile").classList.remove("open"));

  function tickDate(endsAt) {
    clearInterval(state.dateTimer);
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
      $("date-timer").textContent = `${m}:${s}`;
    };
    tick();
    state.dateTimer = setInterval(tick, 250);
  }

  function syncPauseClock(user) {
    clearInterval(state.pauseClock);
    if (!user || user.status !== "pauze" || !user.pauseUntil) {
      ui.pauseTimer.hidden = true;
      return;
    }
    ui.pauseTimer.hidden = false;
    const tick = () => {
      const left = Math.max(0, user.pauseUntil - Date.now());
      const m = Math.floor(left / 60000);
      const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
      ui.pauseTimer.textContent = `Pauze ${m}:${s}`;
      if (left <= 0) {
        clearInterval(state.pauseClock);
        ui.pauseTimer.hidden = true;
      }
    };
    tick();
    state.pauseClock = setInterval(tick, 250);
  }

  function showAnnounce(text) {
    ui.banner.hidden = false;
    ui.banner.textContent = text;
    clearTimeout(ui.banner._t);
    ui.banner._t = setTimeout(() => {
      ui.banner.hidden = true;
    }, 8000);
  }

  $("btn-logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.reload();
  });

  restore();
})();

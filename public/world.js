(() => {
  const state = {
    world: null,
    canvas: null,
    ctx: null,
    viewport: null,
    layer: null,
    avatarsEl: null,
    cache: null,
    meId: null,
    players: new Map(),
    nodes: new Map(),
    keys: {},
    touch: { up: false, down: false, left: false, right: false },
    camX: 0,
    camY: 0,
    viewW: 0,
    viewH: 0,
    target: null,
    walkT: 0,
    lastSend: 0,
    lastPos: { x: 0, y: 0, moving: false },
    handlers: {},
    raf: 0,
    proximity: 420,
    minimap: null,
  };

  const SPEED = 220;
  const STATUS_COLOR = {
    kennismaken: "#22c55e",
    blokken: "#3b82f6",
    pauze: "#f59e0b",
  };

  function mount(opts) {
    state.canvas = opts.canvas;
    state.ctx = opts.canvas.getContext("2d");
    state.viewport = opts.viewport;
    state.layer = opts.layer;
    state.avatarsEl = opts.avatarsEl;
    state.minimap = opts.minimap || document.getElementById("minimap");
    state.handlers = opts.handlers || {};
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    state.canvas.addEventListener("click", onClick);
    loop(performance.now());
  }

  function setWorld(world) {
    state.world = world;
    state.cache = null;
    if (world.proximity) state.proximity = world.proximity;
    state.layer.style.width = world.width + "px";
    state.layer.style.height = world.height + "px";
  }

  function setMe(id) {
    state.meId = id;
  }

  function upsert(player) {
    const prev = state.players.get(player.id) || {};
    const merged = {
      ...prev,
      ...player,
      walkT: prev.walkT || 0,
      ix: player.x ?? prev.ix ?? player.x,
      iy: player.y ?? prev.iy ?? player.y,
    };
    if (player.x != null) {
      merged.tx = player.x;
      merged.ty = player.y;
    }
    state.players.set(player.id, merged);
    ensureNode(merged);
  }

  function remove(id) {
    state.players.delete(id);
    const node = state.nodes.get(id);
    if (node) node.remove();
    state.nodes.delete(id);
  }

  function applyMoves(moves) {
    for (const m of moves) {
      const p = state.players.get(m.id);
      if (!p) continue;
      if (m.id === state.meId) continue;
      p.tx = m.x;
      p.ty = m.y;
      p.facing = m.facing;
      p.moving = m.moving;
      p.sittingDeskId = m.sittingDeskId;
    }
  }

  function me() {
    return state.players.get(state.meId) || null;
  }

  function resize() {
    const wrap = state.viewport;
    state.viewW = wrap.clientWidth;
    state.viewH = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.canvas.width = state.viewW * dpr;
    state.canvas.height = state.viewH * dpr;
    state.canvas.style.width = state.viewW + "px";
    state.canvas.style.height = state.viewH + "px";
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.cache = null;
  }

  function onKey(e) {
    if (shouldIgnoreKey(e)) return;
    state.keys[e.key.toLowerCase()] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    if (e.key.toLowerCase() === "e") {
      e.preventDefault();
      sitNearest();
    }
  }
  function onKeyUp(e) {
    state.keys[e.key.toLowerCase()] = false;
  }
  function shouldIgnoreKey(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
  }

  function setTouch(dir, down) {
    state.touch[dir] = down;
  }

  function occupiedDeskIds() {
    const ids = new Set();
    const self = me();
    for (const p of state.players.values()) {
      if (p.sittingDeskId && p.id !== self?.id) ids.add(Number(p.sittingDeskId));
    }
    return ids;
  }

  function sitNearest() {
    if (!state.world) return;
    const self = me();
    if (!self) return;
    const taken = occupiedDeskIds();
    let best = null;
    let bestD = 180;
    for (const desk of state.world.desks) {
      if (taken.has(desk.id)) continue;
      const d = Math.hypot(self.x - desk.seatX, self.y - desk.seatY);
      if (d < bestD) {
        best = desk;
        bestD = d;
      }
    }
    if (best) sitAt(best);
  }

  function sitAt(desk) {
    const self = me();
    if (self) {
      self.sittingDeskId = desk.id;
      self.x = desk.seatX;
      self.y = desk.seatY;
      self.moving = false;
    }
    state.handlers.onSit?.(desk.id);
    state.target = null;
  }

  function goToDesk(deskId) {
    const desk = state.world?.desks.find((d) => d.id === Number(deskId));
    if (!desk) return false;
    if (occupiedDeskIds().has(desk.id)) return false;
    sitAt(desk);
    return true;
  }

  function onClick(e) {
    const worldPt = screenToWorld(e.clientX, e.clientY);
    const person = hitPerson(worldPt.x, worldPt.y);
    if (person && person.id !== state.meId) {
      state.handlers.onClickPerson?.(person.id);
      return;
    }
    const self = me();
    const desk = hitDesk(worldPt.x, worldPt.y);
    if (desk) {
      if (occupiedDeskIds().has(desk.id)) {
        state.handlers.onSit?.(desk.id);
        return;
      }
      sitAt(desk);
      return;
    }
    if (self?.sittingDeskId) {
      self.sittingDeskId = null;
      state.handlers.onStand?.();
    }
    state.target = worldPt;
  }

  function screenToWorld(clientX, clientY) {
    const rect = state.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left + state.camX,
      y: clientY - rect.top + state.camY,
    };
  }

  function hitPerson(x, y) {
    let best = null;
    let bestD = 40;
    for (const p of state.players.values()) {
      const d = Math.hypot(x - p.x, y - (p.y - 40));
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  function hitDesk(x, y) {
    if (!state.world) return null;
    return state.world.desks.find((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h + 40) || null;
  }

  function loop(ts) {
    state.raf = requestAnimationFrame(loop);
    if (!state.world) return;
    const dt = Math.min(0.05, (ts - (state.lastTs || ts)) / 1000);
    state.lastTs = ts;
    update(dt);
    draw();
    syncDom();
  }

  function wantedDir() {
    let dx = 0;
    let dy = 0;
    if (state.keys.a || state.keys.arrowleft || state.touch.left) dx -= 1;
    if (state.keys.d || state.keys.arrowright || state.touch.right) dx += 1;
    if (state.keys.w || state.keys.arrowup || state.touch.up) dy -= 1;
    if (state.keys.s || state.keys.arrowdown || state.touch.down) dy += 1;
    return { dx, dy };
  }

  function blocked(x, y) {
    const r = 26;
    const boxes = [
      ...(state.world.desks || []),
      ...(state.world.speedTables || []),
      ...(state.world.zones || []).filter((z) => z.id === "bar" || z.id === "stage" || z.id === "info"),
    ];
    for (const b of boxes) {
      const nx = Math.max(b.x, Math.min(x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(y, b.y + b.h));
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
    }
    return false;
  }

  function tryMove(self, dx, dy) {
    const nx = self.x + dx;
    const ny = self.y + dy;
    if (!blocked(nx, ny)) {
      self.x = nx;
      self.y = ny;
      return;
    }
    if (!blocked(nx, self.y)) self.x = nx;
    else if (!blocked(self.x, ny)) self.y = ny;
  }

  function update(dt) {
    const self = me();
    if (!self) return;
    const dir = wantedDir();
    let moving = false;
    if (self.sittingDeskId && (dir.dx || dir.dy)) {
      state.handlers.onStand?.();
      self.sittingDeskId = null;
    }
    if (!self.sittingDeskId) {
      if (dir.dx || dir.dy) {
        const len = Math.hypot(dir.dx, dir.dy) || 1;
        tryMove(self, (dir.dx / len) * SPEED * dt, (dir.dy / len) * SPEED * dt);
        self.facing = dir.dx < 0 ? -1 : dir.dx > 0 ? 1 : self.facing;
        moving = true;
        state.target = null;
      } else if (state.target) {
        const tdx = state.target.x - self.x;
        const tdy = state.target.y - self.y;
        const dist = Math.hypot(tdx, tdy);
        if (dist > 6) {
          tryMove(self, (tdx / dist) * SPEED * dt, (tdy / dist) * SPEED * 0.9 * dt);
          self.facing = tdx < 0 ? -1 : 1;
          moving = true;
        } else state.target = null;
      }
      self.x = Math.max(50, Math.min(state.world.width - 50, self.x));
      self.y = Math.max(90, Math.min(state.world.height - 50, self.y));
    }
    self.moving = moving;
    self.ix = self.x;
    self.iy = self.y;
    if (moving) self.walkT += dt * 10;

    for (const p of state.players.values()) {
      if (p.id === state.meId) continue;
      if (p.tx == null) continue;
      p.ix = p.ix == null ? p.x : p.ix;
      p.iy = p.iy == null ? p.y : p.iy;
      p.ix += (p.tx - p.ix) * Math.min(1, dt * 12);
      p.iy += (p.ty - p.iy) * Math.min(1, dt * 12);
      p.x = p.ix;
      p.y = p.iy;
      if (p.moving) p.walkT = (p.walkT || 0) + dt * 10;
    }

    const now = performance.now();
    if (now - state.lastSend > 50) {
      const changed =
        Math.abs(self.x - state.lastPos.x) > 1 ||
        Math.abs(self.y - state.lastPos.y) > 1 ||
        self.moving !== state.lastPos.moving;
      if (changed) {
        state.handlers.onMove?.({
          x: self.x,
          y: self.y,
          facing: self.facing,
          moving: self.moving,
        });
        state.lastPos = { x: self.x, y: self.y, moving: self.moving };
      }
      state.lastSend = now;
    }

    state.camX += (self.x - state.viewW / 2 - state.camX) * 0.12;
    state.camY += (self.y - state.viewH / 2 - state.camY) * 0.12;
    state.camX = Math.max(0, Math.min(state.world.width - state.viewW, state.camX));
    state.camY = Math.max(0, Math.min(state.world.height - state.viewH, state.camY));
    if (state.world.width < state.viewW) state.camX = (state.world.width - state.viewW) / 2;
    if (state.world.height < state.viewH) state.camY = (state.world.height - state.viewH) / 2;
  }

  function ensureCache() {
    const w = state.world;
    if (state.cache && state.cache.width === w.width) return;
    const c = document.createElement("canvas");
    c.width = w.width;
    c.height = w.height;
    const ctx = c.getContext("2d");
    drawStatic(ctx, w);
    state.cache = c;
  }

  function drawStatic(ctx, w) {
    ctx.fillStyle = "#2a1c16";
    ctx.fillRect(0, 0, w.width, w.height);
    ctx.fillStyle = "#3a281e";
    for (let y = 80; y < w.height; y += 28) {
      ctx.fillRect(0, y, w.width, 2);
    }
    for (let x = 0; x < w.width; x += 90) {
      ctx.fillStyle = x % 180 === 0 ? "#241610" : "#2e1d16";
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x, 0, 90, w.height);
    }
    ctx.globalAlpha = 1;

    const stripe = ctx.createLinearGradient(0, 0, 0, 220);
    stripe.addColorStop(0, "#4a1024");
    stripe.addColorStop(1, "rgba(42,20,24,0)");
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 0, w.width, 220);
    ctx.fillStyle = "#1a0c10";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w.width, 0);
    ctx.lineTo(w.width, 90);
    ctx.lineTo(w.width / 2, 30);
    ctx.lineTo(0, 90);
    ctx.closePath();
    ctx.fill();

    roundRect(ctx, 90, 100, 600, 130, 16, "#3b241c");
    ctx.fillStyle = "#F5C518";
    ctx.font = "800 28px Outfit, sans-serif";
    ctx.fillText("Koffie & fris", 120, 150);
    ctx.fillStyle = "#fff6e0";
    ctx.font = "500 16px Outfit, sans-serif";
    ctx.fillText("Even rechtstaan? Haal een kop en kom praten.", 120, 180);
    ctx.fillStyle = "#6b3a28";
    for (let i = 0; i < 5; i++) roundRect(ctx, 140 + i * 90, 188, 54, 28, 6, "#6b3a28");

    roundRect(ctx, 760, 88, 880, 140, 18, "#201018");
    ctx.fillStyle = "#E91E8C";
    ctx.font = "800 42px Bebas Neue, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PUKKELBLOK  ·  CLUB-TENT", 1200, 150);
    ctx.fillStyle = "#F5C518";
    ctx.font = "600 18px Outfit, sans-serif";
    ctx.fillText("Blokken aan je bureau. Kennismaken in de tent.", 1200, 186);
    ctx.textAlign = "left";

    roundRect(ctx, 1710, 100, 600, 130, 16, "#3b241c");
    ctx.fillStyle = "#fff6e0";
    ctx.font = "800 22px Outfit, sans-serif";
    ctx.fillText("Speeddate vanaf 16:30", 1740, 148);
    ctx.font = "500 15px Outfit, sans-serif";
    ctx.fillStyle = "rgba(255,246,224,.8)";
    ctx.fillText("Klik Speeddate in de balk. 3 minuten, één ijsbreker.", 1740, 178);

    roundRect(ctx, 70, 360, 230, 1080, 20, "#241610");
    ctx.fillStyle = "#F5C518";
    ctx.font = "800 20px Outfit, sans-serif";
    ctx.fillText("Lounge", 92, 400);
    ctx.fillStyle = "#8d3a4a";
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(180, 480 + i * 150, 70, 36, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const d of w.desks) {
      roundRect(ctx, d.x, d.y, d.w, d.h, 10, "#6b4428");
      roundRect(ctx, d.x + 10, d.y + 10, d.w - 20, 36, 6, "#1d2430");
      ctx.fillStyle = "#F5C518";
      ctx.font = "800 16px Outfit, sans-serif";
      ctx.fillText("Bureau " + d.label, d.x + 16, d.y + 70);
      ctx.fillStyle = "#4a3224";
      ctx.beginPath();
      ctx.ellipse(d.seatX, d.seatY + 6, 22, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#E91E8C";
    ctx.font = "800 22px Outfit, sans-serif";
    ctx.fillText("Speeddate-hoek", 2060, 350);
    for (const t of w.speedTables) {
      roundRect(ctx, t.x, t.y, t.w, t.h, 12, "#4a2030");
      ctx.fillStyle = "#fff6e0";
      ctx.font = "700 16px Outfit, sans-serif";
      ctx.fillText(t.label, t.x + 16, t.y + 54);
    }

    ctx.strokeStyle = "rgba(245,197,24,.25)";
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, w.width - 48, w.height - 48);
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function draw() {
    const ctx = state.ctx;
    const w = state.world;
    ctx.clearRect(0, 0, state.viewW, state.viewH);
    ctx.save();
    ctx.translate(-state.camX, -state.camY);
    ensureCache();
    ctx.drawImage(state.cache, 0, 0);
    const t = Date.now() / 400;
    for (let i = 0; i < 18; i++) {
      const x = 80 + i * (w.width - 160) / 17;
      const y = 58 + Math.sin(t + i) * 4;
      ctx.fillStyle = i % 2 ? "#F5C518" : "#E91E8C";
      ctx.globalAlpha = 0.55 + Math.sin(t * 1.4 + i) * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawDeskOccupancy(ctx);
    ctx.restore();
    state.layer.style.transform = `translate(${-state.camX}px, ${-state.camY}px)`;
    drawMinimap();
  }

  function drawDeskOccupancy(ctx) {
    if (!state.world) return;
    const taken = occupiedDeskIds();
    const self = me();
    for (const d of state.world.desks) {
      const mine = Number(self?.sittingDeskId) === d.id;
      if (!taken.has(d.id) && !mine) continue;
      ctx.fillStyle = mine ? "rgba(245,197,24,.28)" : "rgba(233,30,140,.32)";
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = mine ? "#F5C518" : "#fff6e0";
      ctx.font = "800 13px Outfit, sans-serif";
      ctx.fillText(mine ? "Jij" : "Bezet", d.x + 16, d.y + 34);
    }
  }

  function drawMinimap() {
    const canvas = state.minimap;
    const w = state.world;
    const self = me();
    if (!canvas || !w || !self) return;
    const ctx = canvas.getContext("2d");
    const mw = canvas.width;
    const mh = canvas.height;
    const sx = mw / w.width;
    const sy = mh / w.height;
    ctx.fillStyle = "#1a1210";
    ctx.fillRect(0, 0, mw, mh);
    ctx.fillStyle = "#3b241c";
    for (const z of w.zones) {
      ctx.fillRect(z.x * sx, z.y * sy, z.w * sx, z.h * sy);
    }
    ctx.fillStyle = "#6b4428";
    for (const d of w.desks) ctx.fillRect(d.x * sx, d.y * sy, d.w * sx, d.h * sy);
    ctx.strokeStyle = "rgba(245,197,24,.7)";
    ctx.strokeRect(state.camX * sx, state.camY * sy, state.viewW * sx, state.viewH * sy);
    for (const p of state.players.values()) {
      ctx.fillStyle = p.id === state.meId ? "#F5C518" : "#E91E8C";
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, p.id === state.meId ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function ensureNode(p) {
    let el = state.nodes.get(p.id);
    if (el) return el;
    el = document.createElement("div");
    el.className = "person" + (p.id === state.meId ? " me" : "");
    el.innerHTML = `
      <div class="bubble"></div>
      <div class="body">
        <div class="legs"><span class="leg l"></span><span class="leg r"></span></div>
        <div class="torso"></div>
        <img class="face" alt=""/>
        <span class="st-dot"></span>
      </div>
      <div class="nametag"></div>`;
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (p.id !== state.meId) state.handlers.onClickPerson?.(p.id);
    });
    state.avatarsEl.appendChild(el);
    state.nodes.set(p.id, el);
    return el;
  }

  function syncDom() {
    for (const p of state.players.values()) {
      const el = ensureNode(p);
      const x = p.ix ?? p.x;
      const y = p.iy ?? p.y;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.zIndex = String(100 + Math.floor(y));
      el.classList.toggle("walking", Boolean(p.moving) && !p.sittingDeskId);
      el.classList.toggle("sitting", Boolean(p.sittingDeskId));
      el.querySelector(".torso").style.background = p.color || "#E91E8C";
      const img = el.querySelector(".face");
      if (img.getAttribute("src") !== p.avatarUrl) img.src = p.avatarUrl;
      el.querySelector(".nametag").textContent = p.firstName;
      el.querySelector(".st-dot").style.background = STATUS_COLOR[p.status] || "#22c55e";
      const bubble = el.querySelector(".bubble");
      if (p.typing && p.draft) {
        bubble.textContent = p.draft;
        bubble.className = "bubble on typing";
      } else if (p.bubble) {
        bubble.textContent = p.bubble;
        bubble.className = "bubble on";
      } else {
        bubble.className = "bubble";
      }
      const self = me();
      if (self && p.id !== self.id) {
        const dist = Math.hypot((p.ix ?? p.x) - self.x, (p.iy ?? p.y) - self.y);
        el.style.opacity = dist > state.proximity ? "0.42" : "1";
        if (dist > state.proximity) bubble.className = "bubble";
      } else {
        el.style.opacity = "1";
      }
    }
  }

  window.BlokWorld = {
    mount,
    setWorld,
    setMe,
    upsert,
    remove,
    applyMoves,
    me,
    setTouch,
    goToDesk,
    sitNearest,
    STATUS_COLOR,
  };
})();

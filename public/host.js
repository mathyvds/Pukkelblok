(() => {
  const login = document.getElementById("login");
  const dash = document.getElementById("dash");
  const err = document.getElementById("login-error");
  let lastReportCount = null;
  let pollTimer = 0;

  async function api(url, opts) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Verzoek mislukt.");
    return data;
  }

  function beep() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      osc.onended = () => ctx.close();
    } catch {
      /* geen geluid op deze laptop */
    }
  }

  function render(state) {
    document.getElementById("s-online").textContent = `${state.online}/${state.max}`;
    document.getElementById("s-desks").textContent = state.desks.filter((d) => d.taken).length + "/" + state.desks.length;
    document.getElementById("s-wait").textContent = String(state.waiting);
    document.getElementById("s-dates").textContent = String(state.dates);
    const zones = state.zones || [];
    const zoneCount = (id) => zones.find((z) => z.id === id)?.count ?? 0;
    document.getElementById("s-study").textContent = String(zoneCount("study"));
    document.getElementById("s-lounge").textContent = String(zoneCount("lounge"));
    document.getElementById("s-bar").textContent = String(zoneCount("coffee"));
    const reportCount = (state.reports || []).length;
    document.getElementById("s-reports").textContent = String(reportCount);
    const reportsWrap = document.getElementById("reports-wrap");
    const reportsStat = document.getElementById("stat-reports");
    if (lastReportCount != null && reportCount > lastReportCount) {
      reportsWrap.classList.add("flash");
      reportsStat.classList.add("flash");
      beep();
      setTimeout(() => {
        reportsWrap.classList.remove("flash");
        reportsStat.classList.remove("flash");
      }, 4000);
    }
    lastReportCount = reportCount;
    if (state.board) {
      document.getElementById("board-title").textContent = state.board.moment || state.board.title;
      document.getElementById("board-sub").textContent = state.board.subtitle || "";
      document.querySelectorAll("#day-card [data-slot]").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.slot === state.board.slotId);
      });
    }
    document.getElementById("reports").innerHTML = (state.reports || []).length
      ? (state.reports || [])
          .map(
            (r) => `<tr>
          <td>${esc(r.fromName)}</td>
          <td>${esc(r.aboutName)}</td>
          <td>${esc(r.reason)}</td>
          <td><button class="kick" data-id="${r.aboutId}">Zet eruit</button></td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty-row">Geen meldingen.</td></tr>`;
    document.getElementById("kicked").innerHTML = (state.kicked || []).length
      ? (state.kicked || [])
          .map(
            (k) => `<tr>
          <td>${esc(k.name)}</td>
          <td><button class="unkick" data-identity="${esc(k.identity)}">Laat weer binnen</button></td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="2" class="empty-row">Niemand geblokkeerd.</td></tr>`;
    document.getElementById("desks").innerHTML = state.desks
      .map(
        (d) =>
          `<div class="desk${d.taken ? " taken" : ""}"><strong>${d.id}</strong><br>${d.taken ? esc(d.by || "bezet") : "vrij"}${
            d.taken ? `<br><button type="button" data-desk="${d.id}">Vrij</button>` : ""
          }</div>`
      )
      .join("");
    document.getElementById("people").innerHTML = state.players
      .map(
        (p) => `<tr>
          <td>${esc(p.firstName)} ${esc(p.lastName)}</td>
          <td>${esc(p.study || "—")}</td>
          <td>${esc(p.status)}</td>
          <td>${p.sittingDeskId || "—"}</td>
          <td><button class="kick" data-id="${p.id}">Zet eruit</button></td>
        </tr>`
      )
      .join("");
    document.querySelectorAll(".kick").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Deze student uit de tent zetten?")) return;
        try {
          const next = await api("/api/host/kick", {
            method: "POST",
            body: JSON.stringify({ id: btn.dataset.id }),
          });
          render(next.state);
        } catch (e) {
          alert(e.message);
        }
      });
    });
    document.querySelectorAll(".unkick").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const next = await api("/api/host/unkick", {
            method: "POST",
            body: JSON.stringify({ identity: btn.dataset.identity }),
          });
          render(next.state);
        } catch (e) {
          alert(e.message);
        }
      });
    });
    document.querySelectorAll("[data-desk]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Bureau ${btn.dataset.desk} vrijgeven? Alleen als de student niet meer in de tent zit.`)) return;
        try {
          const next = await api("/api/host/release-desk", {
            method: "POST",
            body: JSON.stringify({ deskId: Number(btn.dataset.desk) }),
          });
          render(next.state);
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  function esc(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function refresh() {
    const state = await api("/api/host/state");
    render(state);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => refresh().catch(() => {}), 4000);
  }

  async function boot() {
    try {
      const status = await api("/api/host/status");
      if (!status.configured) {
        err.textContent = "Zet HOST_PIN in de omgeving van de server, daarna herstarten.";
        return;
      }
      if (status.authed) {
        login.hidden = true;
        dash.hidden = false;
        await refresh();
        startPolling();
      }
    } catch {
      /* blijf op login */
    }
  }

  document.getElementById("btn-login").addEventListener("click", async () => {
    err.textContent = "";
    try {
      const data = await api("/api/host/login", {
        method: "POST",
        body: JSON.stringify({ pin: document.getElementById("pin").value }),
      });
      login.hidden = true;
      dash.hidden = false;
      render(data.state);
      startPolling();
    } catch (e) {
      err.textContent = e.message;
    }
  });

  document.getElementById("btn-refresh").addEventListener("click", () => refresh().catch((e) => alert(e.message)));
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await api("/api/host/logout", { method: "POST" });
    location.reload();
  });
  document.getElementById("announce-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = document.getElementById("announce-in").value.trim();
    if (!text) return;
    await api("/api/host/announce", { method: "POST", body: JSON.stringify({ text }) });
    document.getElementById("announce-in").value = "";
  });

  async function quietRound(minutes) {
    const label = minutes === 50 ? "iedereen 50 min stil" : "iedereen 25 min stil";
    if (!confirm(`Start een gezamenlijke ronde: ${label}? Speeddates blijven zitten.`)) return;
    try {
      const next = await api("/api/host/quiet-round", {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });
      render(next.state);
    } catch (e) {
      alert(e.message);
    }
  }
  document.getElementById("quiet-25").addEventListener("click", () => quietRound(25));
  document.getElementById("quiet-50").addEventListener("click", () => quietRound(50));
  document.getElementById("day-card").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-slot]");
    if (!btn) return;
    try {
      const next = await api("/api/host/board", {
        method: "POST",
        body: JSON.stringify({ slotId: btn.dataset.slot }),
      });
      render(next.state);
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("moments").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-moment]");
    if (!btn) return;
    try {
      const next = await api("/api/host/moment", {
        method: "POST",
        body: JSON.stringify({ id: btn.dataset.moment === "clear" ? null : btn.dataset.moment }),
      });
      render(next.state);
    } catch (err) {
      alert(err.message);
    }
  });

  boot();
})();

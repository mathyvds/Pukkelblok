(() => {
  const login = document.getElementById("login");
  const dash = document.getElementById("dash");
  const err = document.getElementById("login-error");

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

  function render(state) {
    document.getElementById("s-online").textContent = `${state.online}/${state.max}`;
    document.getElementById("s-desks").textContent = state.desks.filter((d) => d.taken).length + "/" + state.desks.length;
    document.getElementById("s-wait").textContent = String(state.waiting);
    document.getElementById("s-dates").textContent = String(state.dates);
    const zone = (id) => (state.zones || []).find((z) => z.id === id)?.count || 0;
    document.getElementById("s-study").textContent = String(zone("study"));
    document.getElementById("s-lounge").textContent = String(zone("lounge"));
    document.getElementById("s-bar").textContent = String(zone("cafe"));
    if (state.board) {
      document.getElementById("board-title").textContent = state.board.moment || state.board.title;
      document.getElementById("board-sub").textContent = state.board.subtitle;
      document.querySelectorAll("#day-card [data-slot]").forEach((btn) => {
        btn.classList.toggle("on", btn.dataset.slot === state.board.slotId);
      });
    }
    document.getElementById("desks").innerHTML = state.desks
      .map(
        (d) =>
          `<div class="desk${d.taken ? " taken" : ""}"><strong>${d.id}</strong><br>${d.taken ? esc(d.by || "bezet") : "vrij"}</div>`
      )
      .join("");
    document.getElementById("people").innerHTML = state.players
      .map(
        (p) => `<tr>
          <td>${esc(p.firstName)} ${esc(p.lastName)}</td>
          <td>${esc(p.school || "—")}</td>
          <td>${esc(p.study || "—")}</td>
          <td>${esc(p.status)}</td>
          <td>${p.sittingDeskId || "—"}</td>
          <td><button class="kick" data-id="${p.id}">Zet eruit</button></td>
        </tr>`
      )
      .join("");
    document.getElementById("reports").innerHTML = (state.reports || [])
      .slice()
      .reverse()
      .map(
        (r) => `<tr>
          <td>${new Date(r.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}</td>
          <td>${esc(r.fromName)}</td>
          <td>${esc(r.aboutName)}</td>
          <td>${esc(r.reason)}</td>
          <td><button class="kick" data-id="${r.aboutId}">Zet eruit</button></td>
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
  }

  function esc(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  async function refresh() {
    const state = await api("/api/host/state");
    render(state);
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
        setInterval(() => refresh().catch(() => {}), 4000);
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
      setInterval(() => refresh().catch(() => {}), 4000);
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
      const id = btn.dataset.moment === "clear" ? null : btn.dataset.moment;
      const next = await api("/api/host/moment", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      render(next.state);
    } catch (err) {
      alert(err.message);
    }
  });

  boot();
})();

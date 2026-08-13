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

  boot();
})();

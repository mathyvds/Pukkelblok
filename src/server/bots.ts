import type { DeskStyle, School } from "../shared/protocol";
import type { createStore } from "./store";

type Store = ReturnType<typeof createStore>;

type Mode = "study" | "walk" | "table" | "coffee" | "lounge";

type Brain = {
  id: string;
  mode: Mode;
  until: number;
  target: { x: number; y: number } | null;
  lastChat: number;
};

const CAST: {
  firstName: string;
  lastName: string;
  age: number;
  school: School;
  program: string;
  deskId: number;
  preset: number;
  deskStyle: DeskStyle;
  start: Mode;
}[] = [
  { firstName: "Lina", lastName: "Peeters", age: 21, school: "PXL", program: "Informatica", deskId: 5, preset: 1, deskStyle: "laptop", start: "table" },
  { firstName: "Adam", lastName: "Aerts", age: 22, school: "UCLL", program: "Verpleegkunde", deskId: 6, preset: 2, deskStyle: "boeken", start: "table" },
  { firstName: "Nora", lastName: "Hendrickx", age: 20, school: "Universiteit Hasselt", program: "Rechten", deskId: 18, preset: 3, deskStyle: "boeken", start: "study" },
  { firstName: "Jules", lastName: "Martens", age: 23, school: "PXL", program: "Grafische vormgeving", deskId: 19, preset: 4, deskStyle: "festival", start: "walk" },
  { firstName: "Mira", lastName: "Smets", age: 21, school: "UCLL", program: "Bedrijfsmanagement", deskId: 33, preset: 5, deskStyle: "laptop", start: "coffee" },
  { firstName: "Senne", lastName: "Jacobs", age: 19, school: "PXL", program: "Communicatie", deskId: 34, preset: 6, deskStyle: "festival", start: "lounge" },
  { firstName: "Yara", lastName: "Willems", age: 24, school: "Universiteit Hasselt", program: "Geneeskunde", deskId: 49, preset: 7, deskStyle: "boeken", start: "table" },
  { firstName: "Koen", lastName: "Dubois", age: 22, school: "Andere", program: "Productdesign", deskId: 50, preset: 8, deskStyle: "festival", start: "walk" },
];

const LINES = [
  "Iemand nog koffie over?",
  "Welk vak zit er nog in je tweede zit?",
  "Ik blok liever met een beetje rumoer.",
  "Vanavond nog even door, morgen PKP.",
  "Zit jij ook aan deze tafel?",
  "PXL of UHasselt?",
  "Na de examens meteen naar de weide.",
  "Heb je die oefening al gehad?",
  "Ik neem straks 10 min pauze.",
  "De tent ruikt al naar friet.",
  "Speeddate later, of gewoon hier blijven?",
  "Welke act zou je willen zien?",
];

function pick<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

function later(minMs: number, maxMs: number) {
  return Date.now() + minMs + Math.random() * (maxMs - minMs);
}

export function createBots(store: Store) {
  const brains = new Map<string, Brain>();

  function spawnAll() {
    const spawned: string[] = [];
    for (const guest of CAST) {
      if (store.listBots().some((b) => b.firstName === guest.firstName && b.lastName === guest.lastName)) continue;
      const joined = store.join({
        firstName: guest.firstName,
        lastName: guest.lastName,
        age: guest.age,
        school: guest.school,
        program: guest.program,
        deskId: guest.deskId,
        deskStyle: guest.deskStyle,
        isBot: true,
        avatar: { kind: "preset", preset: guest.preset },
      });
      if (!("user" in joined)) continue;
      store.markSimulatedOnline(joined.user.id);
      if (guest.start !== "study") store.setStatus(joined.user.id, guest.start === "table" ? "kennismaken" : "pauze");
      const brain: Brain = {
        id: joined.user.id,
        mode: guest.start,
        until: later(4000, 14000),
        target: null,
        lastChat: 0,
      };
      applyMode(brain, true);
      brains.set(joined.user.id, brain);
      spawned.push(joined.user.id);
    }
    return spawned;
  }

  function applyMode(brain: Brain, immediate = false) {
    const user = store.get(brain.id);
    if (!user) return;
    if (brain.mode === "study") {
      store.setStatus(user.id, "studeren", pick(["statistiek", "arrest", "anatomie", "code"]), pick([25, 50]));
      brain.target = null;
    } else if (brain.mode === "table") {
      store.setStatus(user.id, "kennismaken");
      const table = store.world.tables.find((t) => t.deskIds.includes(user.homeDeskId)) || pick(store.world.tables);
      if (table) store.joinTable(user.id, table.id);
      brain.target = null;
    } else if (brain.mode === "coffee") {
      store.stand(user.id);
      store.setStatus(user.id, "pauze");
      const stools = store.world.seats.filter((s) => s.kind === "stool");
      const stool = pick(stools);
      brain.target = stool ? { x: stool.seatX, y: stool.seatY } : { x: 220, y: 220 };
      if (immediate && stool) store.sitSpot(user.id, stool.id);
    } else if (brain.mode === "lounge") {
      store.stand(user.id);
      store.setStatus(user.id, "kennismaken");
      const circle = pick(store.world.talkCircles);
      brain.target = { x: circle.x + (Math.random() * 40 - 20), y: circle.y + (Math.random() * 40 - 20) };
    } else {
      store.stand(user.id);
      store.setStatus(user.id, "kennismaken");
      const spots = [
        { x: 1600, y: 220 },
        { x: 900, y: 900 },
        { x: 2000, y: 1100 },
        { x: 2800, y: 700 },
        { x: 400, y: 1400 },
      ];
      brain.target = pick(spots);
    }
  }

  function think(brain: Brain) {
    const modes: Mode[] = ["study", "walk", "table", "coffee", "lounge"];
    let next = pick(modes);
    if (next === brain.mode) next = pick(modes.filter((m) => m !== brain.mode));
    brain.mode = next;
    brain.until = later(8000, 22000);
    applyMode(brain);
  }

  function step(dt: number) {
    const updates: { kind: "update" | "chat"; payload: unknown }[] = [];
    const now = Date.now();
    for (const brain of brains.values()) {
      const user = store.get(brain.id);
      if (!user) {
        brains.delete(brain.id);
        continue;
      }
      if (now >= brain.until) {
        think(brain);
        const next = store.get(brain.id);
        if (next) updates.push({ kind: "update", payload: store.publicUser(next) });
      }

      if (brain.target && !user.sittingDeskId && !user.sittingSpotId) {
        const speed = 170;
        const dx = brain.target.x - user.x;
        const dy = brain.target.y - user.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 12) {
          if (brain.mode === "coffee") {
            const stool = store.world.seats.find((s) => Math.hypot(s.seatX - user.x, s.seatY - user.y) < 80 && s.kind === "stool");
            if (stool) {
              const sat = store.sitSpot(user.id, stool.id);
              if ("user" in sat) updates.push({ kind: "update", payload: sat.user });
            }
          }
          brain.target = null;
          user.moving = false;
        } else {
          const stepX = user.x + (dx / dist) * speed * dt;
          const stepY = user.y + (dy / dist) * speed * dt;
          store.botMove(user.id, stepX, stepY);
        }
      }

      if ((brain.mode === "table" || brain.mode === "lounge" || brain.mode === "coffee") && now - brain.lastChat > 9000 + Math.random() * 12000) {
        const live = store.get(brain.id);
        if (live && live.status !== "studeren") {
          const chat = store.addChat(live, pick(LINES), "speak");
          if ("msg" in chat) updates.push({ kind: "chat", payload: chat });
          brain.lastChat = now;
        }
      }
    }
    return updates;
  }

  function despawn() {
    const ids = store.clearBots();
    brains.clear();
    return ids;
  }

  return { spawnAll, step, despawn, brains };
}

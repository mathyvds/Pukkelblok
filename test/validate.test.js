import test from "node:test";
import assert from "node:assert/strict";
import { validateNames, parseAvatar, validateChat, validateStudy, validateDeskId, shirtColor } from "../server/validate.js";
import { createWorld, clampMove, deskById, PLAYER_R, DATE_WAIT_FALLBACK_MS, DESK_COUNT } from "../server/world.js";
import { createStore } from "../server/store.js";

const avatar = { kind: "preset", preset: 1 };

function twoUsers(store, extraA = {}, extraB = {}) {
  const a = store.join({ firstName: "Adam", lastName: "Aerts", avatar, ...extraA }).user;
  const b = store.join({ firstName: "Britt", lastName: "Beelen", avatar, ...extraB }).user;
  store.connect(a.id, "s1");
  store.connect(b.id, "s2");
  return { a, b };
}

test("namen: Nederlandse letters en koppeltekens", () => {
  const ok = validateNames("José", "Van der Berg");
  assert.equal(ok.firstName, "José");
  assert.equal(ok.lastName, "Van der Berg");
});

test("namen: e-mailadressen zijn geen namen", () => {
  const bad = validateNames("lisa@school.be", "Peeters");
  assert.ok(bad.error);
});

test("chat: trim en limiet", () => {
  const ok = validateChat("  hallo tent  ");
  assert.equal(ok.text, "hallo tent");
  assert.ok(validateChat("   ").error);
});

test("vakgebied: lijst of leeg", () => {
  assert.equal(validateStudy("Informatica").study, "Informatica");
  assert.equal(validateStudy("").study, "");
  assert.ok(validateStudy("Hacken").error);
});

test("avatar: preset en te grote foto", () => {
  assert.equal(parseAvatar({ preset: 3 }).preset, 3);
  assert.ok(parseAvatar({ preset: 99 }).error);
  const huge = `data:image/jpeg;base64,${"A".repeat(200000)}`;
  assert.ok(parseAvatar({ dataUrl: huge }).error);
});

test("wereld: botsing houdt je uit de muur", () => {
  const world = createWorld();
  const next = clampMove(world, 200, 200, -40, 200);
  assert.ok(next.x >= PLAYER_R);
});

test("wereld heeft 100 bureaus", () => {
  const world = createWorld();
  assert.equal(world.desks.length, DESK_COUNT);
  assert.equal(DESK_COUNT, 100);
  assert.ok(deskById(world, 1));
  assert.ok(deskById(world, 100));
  assert.equal(deskById(world, 101), null);
  assert.equal(validateDeskId(100).deskId, 100);
  assert.ok(validateDeskId(101).error);
});

test("store: gastaccount zonder e-mail, max 100", () => {
  const store = createStore(createWorld());
  const a = store.join({ firstName: "Lina", lastName: "Peeters", avatar });
  assert.ok(a.user.id);
  assert.equal(a.user.sid.length > 8, true);
  store.connect(a.user.id, "sock-a");
  assert.equal(store.onlineCount(), 1);
  const pub = store.publicUser(a.user);
  assert.equal(pub.firstName, "Lina");
  assert.ok(!("email" in pub));
  assert.ok(shirtColor("LinaPeeters").startsWith("#"));
});

test("speeddate koppelt twee wachtenden", () => {
  const store = createStore(createWorld());
  const { a, b } = twoUsers(store);
  store.joinQueue(a.id);
  store.joinQueue(b.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 1);
  assert.ok(started[0].ice.length > 0);
});

test("speeddate: zelfde vak eerst, anders wachten", () => {
  const store = createStore(createWorld());
  const a = store.join({ firstName: "Adam", lastName: "Aerts", avatar, study: "Informatica" }).user;
  const b = store.join({ firstName: "Britt", lastName: "Beelen", avatar, study: "Rechten" }).user;
  const c = store.join({ firstName: "Cas", lastName: "Claes", avatar, study: "Informatica" }).user;
  store.connect(a.id, "s1");
  store.connect(b.id, "s2");
  store.connect(c.id, "s3");
  store.joinQueue(a.id, true);
  store.joinQueue(b.id, true);
  store.joinQueue(c.id, true);
  const { started, waiting } = store.matchDates();
  assert.equal(started.length, 1);
  const pair = [started[0].a, started[0].b].sort();
  assert.deepEqual(pair, [a.id, c.id].sort());
  assert.equal(waiting, 1);
});

test("speeddate: na wachttijd toch matchen over vak heen", () => {
  const store = createStore(createWorld());
  const { a, b } = twoUsers(store, { study: "Informatica" }, { study: "Rechten" });
  const now = Date.now();
  store.joinQueue(a.id, true);
  store.joinQueue(b.id, true);
  const { started } = store.matchDates(now + DATE_WAIT_FALLBACK_MS + 10);
  assert.equal(started.length, 1);
});

test("privébericht komt niet als spraakwolk in de tent", () => {
  const store = createStore(createWorld());
  const { a, b } = twoUsers(store);
  const result = store.addDm(a, b.id, "geheim");
  assert.equal(result.msg.text, "geheim");
  assert.equal(a.bubble, "");
});

test("pauze loopt af en zet status terug op blokken", () => {
  const store = createStore(createWorld());
  const { a } = twoUsers(store);
  store.setStatus(a.id, "pauze");
  assert.equal(a.status, "pauze");
  assert.ok(a.pauseUntil > Date.now());
  const ended = store.tickPauses(a.pauseUntil + 1);
  assert.equal(ended.length, 1);
  assert.equal(a.status, "blokken");
  assert.equal(a.pauseUntil, 0);
});

test("proximity: verre studenten horen nabije chat niet", () => {
  const store = createStore(createWorld());
  const { a, b } = twoUsers(store);
  a.x = 80;
  a.y = 400;
  b.x = 2200;
  b.y = 1400;
  const near = store.nearbyIds(a.id);
  assert.ok(near.includes(a.id));
  assert.equal(near.includes(b.id), false);
});

test("host kan iemand kicken", () => {
  const store = createStore(createWorld());
  const { a, b } = twoUsers(store);
  const kicked = store.kick(a.id);
  assert.equal(kicked.name, "Adam Aerts");
  assert.equal(store.get(a.id), null);
  assert.ok(store.get(b.id));
});

test("zitten aan bureau 100", () => {
  const store = createStore(createWorld());
  const { a } = twoUsers(store);
  const result = store.sit(a.id, 100);
  assert.equal(result.user.sittingDeskId, 100);
  assert.ok(validateDeskId(0).error);
});

test("chat: tweede bericht te snel wordt genegeerd", () => {
  const store = createStore(createWorld());
  const { a } = twoUsers(store);
  const first = store.addChat(a, "hallo", "near");
  assert.ok(first.msg);
  const second = store.addChat(a, "nog eens", "near");
  assert.equal(second.error, "silent");
});

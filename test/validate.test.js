import test from "node:test";
import assert from "node:assert/strict";
import { validateNames, parseAvatar, validateChat, shirtColor } from "../server/validate.js";
import { createWorld, clampMove, PLAYER_R } from "../server/world.js";
import { createStore } from "../server/store.js";

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

test("store: gastaccount zonder e-mail, max 100", () => {
  const store = createStore(createWorld());
  const avatar = { kind: "preset", preset: 1 };
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
  const avatar = { kind: "preset", preset: 2 };
  const a = store.join({ firstName: "Adam", lastName: "Aerts", avatar }).user;
  const b = store.join({ firstName: "Britt", lastName: "Beelen", avatar }).user;
  store.connect(a.id, "s1");
  store.connect(b.id, "s2");
  store.joinQueue(a.id);
  store.joinQueue(b.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 1);
  assert.ok(started[0].ice.length > 0);
});

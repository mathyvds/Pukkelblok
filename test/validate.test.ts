import test from "node:test";
import assert from "node:assert/strict";
import { validateNames, parseAvatar, validateChat, shirtColor } from "../src/shared/validate";
import { createWorld, clampMove, PLAYER_R } from "../src/shared/world";
import { createStore } from "../src/server/store";
import { joinSchema } from "../src/shared/protocol";

test("namen: Nederlandse letters en koppeltekens", () => {
  const ok = validateNames("José", "Van der Berg");
  assert.equal("firstName" in ok && ok.firstName, "José");
});

test("namen: e-mailadressen zijn geen namen", () => {
  const bad = validateNames("lisa@school.be", "Peeters");
  assert.ok("error" in bad);
});

test("chat: trim en limiet", () => {
  const ok = validateChat("  hallo tent  ");
  assert.equal("text" in ok && ok.text, "hallo tent");
  assert.ok("error" in validateChat("   "));
});

test("avatar: preset en te grote foto", () => {
  const preset = parseAvatar({ preset: 3 });
  assert.equal("preset" in preset && preset.preset, 3);
  assert.ok("error" in parseAvatar({ preset: 99 }));
  const huge = `data:image/jpeg;base64,${"A".repeat(200000)}`;
  assert.ok("error" in parseAvatar({ dataUrl: huge }));
});

test("zod join-schema weigert lege namen", () => {
  const bad = joinSchema.safeParse({ firstName: "", lastName: "Peeters", avatar: { preset: 1 } });
  assert.equal(bad.success, false);
});

test("wereld: botsing houdt je uit de muur", () => {
  const world = createWorld();
  const next = clampMove(world, 200, 200, -40, 200);
  assert.ok(next.x >= PLAYER_R);
});

test("store: gastaccount zonder e-mail", () => {
  const store = createStore(createWorld());
  const avatar = { kind: "preset" as const, preset: 1 };
  const a = store.join({ firstName: "Lina", lastName: "Peeters", avatar });
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "sock-a");
  assert.equal(store.onlineCount(), 1);
  const pub = store.publicUser(a.user);
  assert.equal(pub.firstName, "Lina");
  assert.ok(!("email" in pub));
  assert.ok(shirtColor("LinaPeeters").startsWith("#"));
});

test("speeddate koppelt twee wachtenden", () => {
  const store = createStore(createWorld());
  const avatar = { kind: "preset" as const, preset: 2 };
  const a = store.join({ firstName: "Adam", lastName: "Aerts", avatar });
  const b = store.join({ firstName: "Britt", lastName: "Beelen", avatar });
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 1);
  assert.ok(started[0].ice.length > 0);
});

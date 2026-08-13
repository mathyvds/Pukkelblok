import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNames,
  parseAvatar,
  validateChat,
  shirtColor,
  validateStatusText,
  validateBlockMinutes,
} from "../src/shared/validate";
import { createWorld, clampMove, deskById, PLAYER_R } from "../src/shared/world";
import { createStore } from "../src/server/store";
import { DESK_COUNT, joinSchema } from "../src/shared/protocol";

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

test("statusText: trim en max 60", () => {
  assert.equal(validateStatusText("  statistiek  "), "statistiek");
  assert.equal(validateStatusText("x".repeat(80)).length, 60);
});

test("blokminuten: alleen 25 of 50", () => {
  assert.equal(validateBlockMinutes(25), 25);
  assert.equal(validateBlockMinutes(50), 50);
  assert.equal(validateBlockMinutes(10), null);
  assert.equal(validateBlockMinutes("40"), null);
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

function guest(
  extra: Partial<{
    firstName: string;
    lastName: string;
    age: number;
    school: string;
    program: string;
    deskId: number;
    avatar: { kind: "preset"; preset: number };
  }> = {}
) {
  return {
    firstName: "Lina",
    lastName: "Peeters",
    age: 21,
    school: "PXL",
    program: "Informatica",
    deskId: 3,
    avatar: { kind: "preset" as const, preset: 1 },
    ...extra,
  };
}

test("join zet je aan het gekozen bureau", () => {
  const store = createStore(createWorld());
  const a = store.join(guest());
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "sock-a");
  assert.equal(store.onlineCount(), 1);
  assert.equal(a.user.homeDeskId, 3);
  assert.equal(a.user.sittingDeskId, 3);
  assert.equal(a.user.status, "studeren");
  assert.equal(a.user.school, "PXL");
  const pub = store.publicUser(a.user);
  assert.ok(!("email" in pub));
  assert.ok(shirtColor("LinaPeeters").startsWith("#"));
});

test("twee studenten kunnen hetzelfde bureau niet claimen", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 7 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 7, avatar: { kind: "preset" as const, preset: 2 } }));
  assert.ok("user" in a);
  assert.ok("error" in b);
});

test("status Studeren brengt je terug naar je bureau", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 12 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.stand(a.user.id);
  const back = store.setStatus(a.user.id, "studeren", "");
  assert.equal(back?.sittingDeskId, 12);
  assert.equal(back?.status, "studeren");
});

test("speeddate koppelt twee wachtenden", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken", "");
  store.setStatus(b.user.id, "kennismaken", "");
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 1);
  assert.ok(started[0].ice.length > 0);
});

test("wereld heeft 100 bureaus", () => {
  const world = createWorld();
  assert.equal(world.desks.length, DESK_COUNT);
  assert.equal(DESK_COUNT, 100);
  assert.ok(deskById(world, 1));
  assert.ok(deskById(world, 100));
  assert.equal(deskById(world, 101), null);
});

test("zitten aan bureau 100", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 100 }));
  if (!("user" in a)) throw new Error("expected user");
  assert.equal(a.user.homeDeskId, 100);
  assert.equal(a.user.sittingDeskId, 100);
});

test("privébericht komt niet als spraakwolk", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  const result = store.addDm(a.user, b.user.id, "geheim");
  assert.ok("msg" in result);
  assert.equal(a.user.bubble, "");
});

test("oude socket mag je niet offline zetten na reconnect", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "old-sock");
  const second = store.connect(a.user.id, "new-sock");
  assert.equal(second?.announceJoin, false);
  const dropped = store.dropSocket(a.user.id, "old-sock");
  assert.equal(dropped.stale, true);
  assert.equal(store.get(a.user.id)?.online, true);
});

test("bureau blijft van jou na een lange disconnect", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 7 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.dropSocket(a.user.id, "s1");
  a.user.disconnectedAt = Date.now() - 60_000;
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 7, avatar: { kind: "preset" as const, preset: 2 } })
  );
  assert.ok("error" in b);
  const occ = store.deskOccupancy().find((d) => d.id === 7);
  assert.equal(occ?.taken, true);
});

test("logout geeft bureau meteen vrij", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 4 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  const left = store.logout(a.user.sid);
  assert.ok(left && !("error" in left));
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 4, avatar: { kind: "preset" as const, preset: 2 } })
  );
  assert.ok("user" in b);
});

test("opstaan uit studeermodus start de pauze-timer", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 12 }));
  if (!("user" in a)) throw new Error("expected user");
  const pub = store.stand(a.user.id);
  assert.equal(pub?.status, "pauze");
  assert.ok((pub?.pauseUntil || 0) > Date.now());
});

test("studeren dempt proximity-chat en shout, zonder spraakwolk", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 5 }));
  if (!("user" in a)) throw new Error("expected user");
  const chat = store.addChat(a.user, "hallo", "near");
  assert.ok("error" in chat);
  assert.equal(a.user.bubble, "");
  const shout = store.addChat(a.user, "iedereen", "tent");
  assert.ok("error" in shout);
  store.stand(a.user.id);
  const after = store.addChat(a.user, "pauze-praat", "near");
  assert.ok("msg" in after);
  assert.equal(a.user.bubble, "pauze-praat");
});

test("statusText blijft staan als pauze afloopt", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 8 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "pauze", "arrest");
  assert.equal(a.user.statusText, "arrest");
  a.user.pauseUntil = Date.now() - 1;
  const { pauseEnded } = store.tickTimers();
  assert.equal(pauseEnded.length, 1);
  assert.equal(pauseEnded[0].status, "studeren");
  assert.equal(pauseEnded[0].statusText, "arrest");
});

test("statusText wijzigen wist de bloktimer niet", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 9 }));
  if (!("user" in a)) throw new Error("expected user");
  const block = store.startBlock(a.user.id, 25);
  assert.ok("user" in block);
  const until = block.user.blockUntil;
  const again = store.setStatus(a.user.id, "studeren", "statistiek");
  assert.equal(again?.statusText, "statistiek");
  assert.equal(again?.blockUntil, until);
  assert.equal(again?.blockMinutes, 25);
});

test("blok van 25 min eindigt in 5 min pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 11 }));
  if (!("user" in a)) throw new Error("expected user");
  const block = store.startBlock(a.user.id, 25);
  assert.ok("user" in block);
  assert.equal(block.user.status, "studeren");
  assert.ok(block.user.blockUntil > Date.now() + 24 * 60 * 1000);
  a.user.blockUntil = Date.now() - 1;
  const { blockEnded } = store.tickTimers();
  assert.equal(blockEnded.length, 1);
  assert.equal(blockEnded[0].pauseMinutes, 5);
  assert.equal(blockEnded[0].user.status, "pauze");
  assert.ok(blockEnded[0].user.pauseUntil > Date.now() + 4 * 60 * 1000);
  assert.equal(blockEnded[0].user.blockUntil, 0);
});

test("blok van 50 min eindigt in 10 min pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 13 }));
  if (!("user" in a)) throw new Error("expected user");
  store.startBlock(a.user.id, 50);
  a.user.blockUntil = Date.now() - 1;
  const { blockEnded } = store.tickTimers();
  assert.equal(blockEnded[0]?.pauseMinutes, 10);
});

test("hostronde zet iedereen 50 min stil", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset", preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken");
  store.setStatus(b.user.id, "pauze", "pauze tot 11u");
  const round = store.startQuietRound(50);
  assert.ok("players" in round);
  assert.equal(round.players.length, 2);
  assert.match(round.announce, /50 min stil/);
  assert.equal(store.get(a.user.id)?.status, "studeren");
  assert.equal(store.get(b.user.id)?.status, "studeren");
  assert.equal(store.get(b.user.id)?.statusText, "pauze tot 11u");
  assert.equal(store.get(a.user.id)?.blockMinutes, 50);
});

test("WASD tijdens een blok schakelt naar pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 14 }));
  if (!("user" in a)) throw new Error("expected user");
  store.startBlock(a.user.id, 50);
  const pub = store.stand(a.user.id);
  assert.equal(pub?.status, "pauze");
  assert.equal(pub?.blockUntil, 0);
  assert.ok((pub?.pauseUntil || 0) > Date.now());
});

test("typ-bubbel gaat uit in studeermodus", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 15 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "pauze");
  store.setTyping(a.user.id, true, "hey");
  assert.equal(a.user.draft, "hey");
  store.setStatus(a.user.id, "studeren");
  const typing = store.setTyping(a.user.id, true, "stiekem");
  assert.equal(typing?.typing, false);
  assert.equal(a.user.draft, "");
});

test("wereldmuren houden je uit de rand", () => {
  const world = createWorld();
  const next = clampMove(world, 200, 200, 10, 200);
  assert.ok(next.x > 40);
});

test("reconnect binnen grace is geen nieuwe join-aankondiging", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 2 }));
  if (!("user" in a)) throw new Error("expected user");
  const first = store.connect(a.user.id, "s1");
  assert.equal(first?.announceJoin, true);
  store.dropSocket(a.user.id, "s1");
  const second = store.connect(a.user.id, "s2");
  assert.equal(second?.announceJoin, false);
  store.dropSocket(a.user.id, "s2");
  store.finishDisconnect(a.user.id);
  const third = store.connect(a.user.id, "s3");
  assert.equal(third?.announceJoin, true);
});

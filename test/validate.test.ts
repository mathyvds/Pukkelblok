import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNames,
  parseAvatar,
  validateChat,
  shirtColor,
  validateStatusText,
  validateStudyMinutes,
} from "../src/shared/validate";
import { createWorld, clampMove, deskById, inZone, PLAYER_R } from "../src/shared/world";
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
  assert.equal(validateStudyMinutes(25), 25);
  assert.equal(validateStudyMinutes(50), 50);
  assert.equal(validateStudyMinutes(10), null);
  assert.equal(validateStudyMinutes("40"), null);
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

test("statusText blijft staan als pauze afloopt", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 8 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "pauze", "arrest");
  assert.equal(a.user.statusText, "arrest");
  a.user.pauseUntil = Date.now() - 1;
  const pauseEnded = store.tickPauses();
  assert.equal(pauseEnded.length, 1);
  assert.equal(pauseEnded[0].status, "studeren");
  assert.equal(pauseEnded[0].statusText, "arrest");
});

test("statusText wijzigen wist de bloktimer niet", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 9 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "studeren", "", 25);
  const until = a.user.studyUntil;
  const again = store.setStatus(a.user.id, "studeren", "statistiek");
  assert.equal(again?.statusText, "statistiek");
  assert.equal(again?.studyUntil, until);
});

test("blok van 25 min eindigt in 5 min pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 11 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "studeren", undefined, 25);
  assert.ok(a.user.studyUntil > Date.now() + 24 * 60 * 1000);
  a.user.studyUntil = Date.now() - 1;
  const ended = store.tickStudyTimers();
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, "pauze");
  assert.ok(ended[0].pauseUntil > Date.now() + 4 * 60 * 1000);
  assert.equal(ended[0].studyUntil, 0);
});

test("blok van 50 min eindigt in 10 min pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 13 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "studeren", undefined, 50);
  a.user.studyUntil = Date.now() - 1;
  const ended = store.tickStudyTimers();
  assert.ok((ended[0]?.pauseUntil || 0) > Date.now() + 9 * 60 * 1000);
});

test("hostronde zet iedereen 50 min stil", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset", preset: 2 } })
  );
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
  assert.ok((store.get(a.user.id)?.studyUntil || 0) > Date.now() + 49 * 60 * 1000);
});

test("WASD tijdens een blok schakelt naar pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 14 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "studeren", undefined, 50);
  const pub = store.stand(a.user.id);
  assert.equal(pub?.status, "pauze");
  assert.equal(pub?.studyUntil, 0);
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

test("wereld heeft koffiehoek, praatcirkels en tafelzitjes", () => {
  const world = createWorld();
  assert.ok(world.zones.some((z) => z.id === "coffee"));
  assert.ok(world.talkCircles.length >= 8);
  assert.equal(world.talkCircles[0].max, 4);
  assert.ok(world.speedTables[0].seatAx);
  assert.ok(inZone(world, 120, 220, "coffee"));
  assert.equal(inZone(world, 120, 220, "study"), false);
});

test("studeermodus blokkeert chat en shout", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 5 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  const speak = store.addChat(a.user, "psst", "speak");
  const shout = store.addChat(a.user, "hallo tent", "shout");
  assert.ok("error" in speak);
  assert.ok("error" in shout);
  store.setStatus(a.user.id, "kennismaken", "");
  a.user.x = 120;
  a.user.y = 220;
  const ok = store.addChat(a.user, "koffie?", "speak");
  assert.ok("msg" in ok);
  if ("msg" in ok) assert.equal(ok.msg.scope, "coffee");
});

test("bloktimer zet je na afloop op pauze", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 8 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.setStatus(a.user.id, "studeren", "", 25);
  assert.ok((a.user.studyUntil || 0) > Date.now());
  a.user.studyUntil = Date.now() - 10;
  const ended = store.tickStudyTimers();
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, "pauze");
});

test("lounge-praatcirkel deelt chat zonder matching", () => {
  const store = createStore(createWorld());
  const world = store.world;
  const circle = world.talkCircles[0];
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken", "");
  store.setStatus(b.user.id, "kennismaken", "");
  store.stand(a.user.id);
  store.stand(b.user.id);
  a.user.x = circle.x;
  a.user.y = circle.y;
  b.user.x = circle.x + 20;
  b.user.y = circle.y;
  const changed = store.assignTalkCircles();
  assert.ok(changed.length >= 2);
  assert.equal(a.user.talkCircleId, circle.id);
  assert.equal(b.user.talkCircleId, circle.id);
  const chat = store.addChat(a.user, "hey", "speak");
  assert.ok("msg" in chat && chat.msg.scope === "circle");
  if ("ids" in chat) {
    assert.ok(chat.ids.includes(a.user.id));
    assert.ok(chat.ids.includes(b.user.id));
  }
});

test("speeddate zet jullie aan een tafel in de tent", () => {
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
  assert.ok(started[0].tableId);
  assert.equal(a.user.dateTableId, started[0].tableId);
  assert.equal(b.user.dateTableId, started[0].tableId);
  const table = store.world.speedTables.find((t) => t.id === started[0].tableId);
  assert.ok(table);
  assert.equal(a.user.x, table?.seatAx);
  assert.equal(b.user.x, table?.seatBx);
  const chat = store.addChat(a.user, "hoi", "speak");
  assert.ok("msg" in chat && chat.msg.scope === "date");
});

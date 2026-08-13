import test from "node:test";
import assert from "node:assert/strict";
import { validateNames, parseAvatar, validateChat, shirtColor, validateWave, validateReportReason } from "../src/shared/validate";
import { createWorld, clampMove, deskById, inZone, PLAYER_R, ICEBREAKERS, onboardText } from "../src/shared/world";
import { createStore } from "../src/server/store";
import { DESK_COUNT, joinSchema, PAUSE_MS, WAVES } from "../src/shared/protocol";

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

test("wereld heeft krukken, loungeplekken en geen dashboard-muren", () => {
  const world = createWorld();
  assert.ok(world.seats.filter((s) => s.kind === "stool").length >= 6);
  assert.ok(world.seats.filter((s) => s.kind === "lounge").length >= 6);
  assert.ok(world.blockers.length > 0);
  const ontoStage = clampMove(world, 1600, 280, 1600, 160);
  assert.ok(ontoStage.y < 200, "het lege podium moet begaanbaar zijn");
  const intoBar = clampMove(world, 400, 260, 400, 110);
  assert.ok(intoBar.y > 150, "de koffietoog blijft een obstakel");
});

test("zitten in de lounge claimt je bureau niet", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 12 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.stand(a.user.id);
  const spot = store.sitSpot(a.user.id, "lounge-1a");
  assert.ok("user" in spot);
  assert.equal(spot.user.sittingSpotId, "lounge-1a");
  assert.equal(spot.user.sittingDeskId, null);
  assert.equal(spot.user.homeDeskId, 12);
  assert.equal(spot.user.status, "pauze");
  const occ = store.deskOccupancy().find((d) => d.id === 12);
  assert.equal(occ?.taken, true);
});

test("twee studenten kunnen niet op dezelfde kruk", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } })
  );
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.stand(a.user.id);
  store.stand(b.user.id);
  const first = store.sitSpot(a.user.id, "stool-1");
  const second = store.sitSpot(b.user.id, "stool-1");
  assert.ok("user" in first);
  assert.ok("error" in second);
});

test("studeren vanuit de koffiebar brengt je terug naar je bureau", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 15 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.stand(a.user.id);
  store.sitSpot(a.user.id, "stool-3");
  const back = store.setStatus(a.user.id, "studeren", "");
  assert.equal(back?.sittingDeskId, 15);
  assert.equal(back?.sittingSpotId, null);
  assert.equal(back?.status, "studeren");
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
  const before = { x: a.user.x, y: a.user.y };
  store.move(a.user.id, a.user.x + 80, a.user.y + 80, 1, true);
  assert.equal(a.user.x, before.x);
  assert.equal(a.user.y, before.y);
});

test("zwaai is een emoji, geen chatbericht", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  const waved = store.wave(a.user.id, "👋");
  assert.ok("user" in waved);
  assert.equal(waved.user.bubble, "👋");
  assert.equal(waved.user.waving, "👋");
  assert.equal(store.chatHistory().length, 0);
  assert.ok("error" in validateWave("🔥"));
  const ok = validateWave(WAVES[0]);
  assert.ok("emoji" in ok);
  assert.equal(ok.emoji, "👋");
  const again = store.wave(a.user.id, "☕");
  assert.ok("error" in again);
});

test("praatcirkel: max 4, studeren blijft erbuiten", () => {
  const store = createStore(createWorld());
  const circle = store.world.talkCircles[0];
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const g = store.join(
      guest({
        firstName: `Gast${i}`,
        lastName: "Test",
        deskId: i + 1,
        avatar: { kind: "preset", preset: (i % 8) + 1 },
      })
    );
    if (!("user" in g)) throw new Error("expected user");
    store.connect(g.user.id, `s${i}`);
    store.setStatus(g.user.id, "kennismaken", "");
    store.stand(g.user.id);
    g.user.x = circle.x;
    g.user.y = circle.y;
    ids.push(g.user.id);
  }
  store.assignTalkCircles();
  assert.equal(store.get(ids[0])?.talkCircleId, circle.id);
  assert.equal(store.get(ids[3])?.talkCircleId, circle.id);
  assert.equal(store.get(ids[4])?.talkCircleId, null);
  const chat = store.addChat(store.get(ids[0])!, "hey cirkel", "speak");
  assert.ok("msg" in chat);
  if ("msg" in chat) assert.equal(chat.msg.scope, "circle");

  const student = store.join(
    guest({ firstName: "Blok", lastName: "Kees", deskId: 20, avatar: { kind: "preset", preset: 2 } })
  );
  if (!("user" in student)) throw new Error("expected user");
  store.connect(student.user.id, "s-st");
  student.user.x = circle.x;
  student.user.y = circle.y;
  store.assignTalkCircles();
  assert.equal(store.get(student.user.id)?.talkCircleId, null);
});

test("schoolhoekjes staan op de eerste vier praatcirkels", () => {
  const world = createWorld();
  assert.equal(world.talkCircles.length, 8);
  assert.equal(world.talkCircles[0].label, "PXL");
  assert.equal(world.talkCircles[1].label, "UCLL");
  assert.equal(world.talkCircles[2].label, "UHasselt");
  assert.equal(world.talkCircles[3].label, "Andere");
  assert.equal(world.talkCircles[4].school, undefined);
  assert.ok(world.zones.some((z) => z.id === "coffee"));
  assert.equal(world.speedTables.length, 6);
  assert.ok(world.speedTables[0].seatAx);
  assert.equal(world.desks.length, 100);
});

test("speeddate verder chatten: ja/ja houdt DM, nee wist hem", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } })
  );
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken", "");
  store.setStatus(b.user.id, "kennismaken", "");
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const t0 = Date.now();
  store.matchDates(t0);
  store.addDm(a.user, b.user.id, "leuke date");
  store.matchDates(t0 + 3 * 60 * 1000);
  const first = store.answerContinue(a.user.id, true);
  assert.ok("pending" in first);
  const both = store.answerContinue(b.user.id, true);
  assert.ok("keep" in both && both.keep);
  assert.equal(store.getDms(a.user.id, b.user.id).length, 1);
  assert.equal(a.user.dateTableId, null);

  const c = store.join(
    guest({ firstName: "Chris", lastName: "Claes", deskId: 3, avatar: { kind: "preset" as const, preset: 3 } })
  );
  const d = store.join(
    guest({ firstName: "Dina", lastName: "Dries", deskId: 4, avatar: { kind: "preset" as const, preset: 4 } })
  );
  if (!("user" in c) || !("user" in d)) throw new Error("expected users");
  store.connect(c.user.id, "s3");
  store.connect(d.user.id, "s4");
  store.setStatus(c.user.id, "kennismaken", "");
  store.setStatus(d.user.id, "kennismaken", "");
  store.joinQueue(c.user.id);
  store.joinQueue(d.user.id);
  const t1 = Date.now();
  store.matchDates(t1);
  store.addDm(c.user, d.user.id, "hey");
  store.matchDates(t1 + 3 * 60 * 1000);
  const no = store.answerContinue(c.user.id, false);
  assert.ok("keep" in no && !no.keep);
  assert.equal(store.getDms(c.user.id, d.user.id).length, 0);
  assert.equal(c.user.dateTableId, null);
});

test("ijsbrekers werken aan de bar en op het profiel", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 5 }));
  if (!("user" in a)) throw new Error("expected user");
  const bar = store.sayIce(a.user.id, "bar");
  assert.ok("text" in bar);
  assert.ok(ICEBREAKERS.includes(bar.text));
  assert.equal(a.user.bubble, bar.text);
  const profile = store.sayIce(a.user.id, "profile", "someone");
  assert.ok("text" in profile);
});

test("pauze loopt af zonder teleport; verlengen of kennismaken", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 12 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  store.stand(a.user.id);
  const lounge = store.world.talkCircles[0];
  a.user.x = lounge.x;
  a.user.y = lounge.y;
  const loungeX = a.user.x;
  const nudged = store.tickPauses(Date.now() + PAUSE_MS + 50);
  assert.equal(nudged.length, 1);
  assert.equal(a.user.status, "pauze");
  assert.equal(a.user.pauseUntil, 0);
  assert.equal(a.user.sittingDeskId, null);
  assert.equal(a.user.x, loungeX);
  const extra = store.extendPause(a.user.id);
  assert.ok((extra?.pauseUntil || 0) > Date.now());
  const hang = store.hangOut(a.user.id);
  assert.equal(hang?.status, "kennismaken");
  assert.equal(a.user.x, loungeX);
});

test("blokkeren stopt DM en speeddate", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } })
  );
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.block(a.user.id, b.user.id);
  const dm = store.addDm(a.user, b.user.id, "nee");
  assert.ok("error" in dm);
  store.setStatus(a.user.id, "kennismaken", "");
  store.setStatus(b.user.id, "kennismaken", "");
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 0);
  assert.ok("reason" in validateReportReason("Lastigvallen"));
});

test("dagkaart en zonebezetting", () => {
  const store = createStore(createWorld());
  const board = store.setBoard({ slotId: "koffie" });
  assert.equal(board.title, "Koffie");
  const moment = store.setBoard({ moment: "Iedereen even rechtstaan" });
  assert.equal(moment.moment, "Iedereen even rechtstaan");
  const a = store.join(guest({ deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  const study = store.zoneOccupancy().find((z) => z.id === "study");
  assert.equal(study?.count, 1);
  store.setStatus(a.user.id, "kennismaken", "");
  store.stand(a.user.id);
  a.user.x = 185;
  a.user.y = 1500;
  const lounge = store.zoneOccupancy().find((z) => z.id === "lounge");
  assert.equal(lounge?.count, 1);
  const coffee = store.zoneOccupancy().find((z) => z.id === "coffee");
  assert.equal(coffee?.count, 0);
  assert.equal(
    onboardText(42),
    "Je zit aan bureau 42. Blokken = blijven zitten. Pauze = lounge of koffie. Kennismaken = rondlopen."
  );
});

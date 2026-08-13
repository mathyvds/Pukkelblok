import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNames,
  parseAvatar,
  validateChat,
  shirtColor,
  sniffImageMime,
  validateStatusText,
  validateStudyMinutes,
  validateWave,
  validateReportReason,
} from "../src/shared/validate";
import { createWorld, clampMove, deskById, inZone, onboardText, schoolCornerAt, ICEBREAKERS, PLAYER_R } from "../src/shared/world";
import { createStore } from "../src/server/store";
import { cookieSecure, createRateLimit, requireCookieSecret, timingSafeEqualString } from "../src/server/security";
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

test("wereld heeft 100 bureaus in tafelclusters", () => {
  const world = createWorld();
  assert.equal(world.desks.length, DESK_COUNT);
  assert.equal(DESK_COUNT, 100);
  assert.ok(deskById(world, 1));
  assert.ok(deskById(world, 100));
  assert.equal(deskById(world, 101), null);
  assert.equal(world.desks[0].tableId, world.desks[1].tableId);
  assert.ok((world.tables || []).length >= 25);
});

test("je kunt tussen tafels door lopen zonder vast te lopen", () => {
  const world = createWorld();
  assert.ok((world.tables || []).length >= 25);
  const table = world.tables[0];
  const aisleX = table.x + table.w + 50;
  const startY = table.y - 40;
  const end = clampMove(world, aisleX, startY, aisleX, table.y + table.h + 50);
  assert.ok(end.y > table.y + table.h, "het gangpad naast een tafel blijft open");
  const across = clampMove(world, table.x - 40, table.y + table.h / 2, table.x + table.w + 40, table.y + table.h / 2);
  assert.ok(across.x > table.x + table.w - 10 || across.x < table.x + 10, "je glijdt langs het blad, niet erdoor");
});

test("tafelbubbel: alleen tafelgenoten horen je", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 5 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 6, avatar: { kind: "preset" as const, preset: 2 } }));
  const c = store.join(guest({ firstName: "Chris", lastName: "Claes", deskId: 21, avatar: { kind: "preset" as const, preset: 3 } }));
  if (!("user" in a) || !("user" in b) || !("user" in c)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.connect(c.user.id, "s3");
  store.setStatus(a.user.id, "kennismaken");
  store.setStatus(b.user.id, "kennismaken");
  store.setStatus(c.user.id, "kennismaken");
  const table = store.world.tables.find((t) => t.deskIds.includes(5));
  assert.ok(table);
  const joinedA = store.joinTable(a.user.id, table!.id);
  const joinedB = store.joinTable(b.user.id, table!.id);
  assert.ok("user" in joinedA && "user" in joinedB);
  assert.equal(joinedA.user.tableId, table!.id);
  assert.equal(joinedB.user.tableId, table!.id);
  const chat = store.addChat(a.user, "alleen deze tafel", "speak");
  assert.ok("msg" in chat && chat.msg.scope === "table");
  if ("ids" in chat) {
    assert.ok(chat.ids.includes(a.user.id));
    assert.ok(chat.ids.includes(b.user.id));
    assert.equal(chat.ids.includes(c.user.id), false);
  }
});

test("studeren aan je bureau is geen sociale bubbel", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 5 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  const pub = store.publicUser(a.user);
  assert.equal(pub.tableId, null);
  assert.equal(pub.isBot, false);
});

test("AI-bots kunnen de tent vullen om te simuleren", () => {
  const store = createStore(createWorld());
  const bot = store.join({
    firstName: "Lina",
    lastName: "Peeters",
    age: 21,
    school: "PXL",
    program: "Informatica",
    deskId: 5,
    isBot: true,
    deskStyle: "laptop",
    avatar: { kind: "preset", preset: 1 },
  });
  if (!("user" in bot)) throw new Error("expected bot");
  store.markSimulatedOnline(bot.user.id);
  assert.equal(store.publicUser(bot.user).isBot, true);
  assert.equal(store.onlineCount(), 1);
  store.setStatus(bot.user.id, "kennismaken");
  const table = store.world.tables.find((t) => t.deskIds.includes(5));
  const sat = store.joinTable(bot.user.id, table!.id);
  assert.ok("user" in sat);
  assert.equal(sat.user.tableId, table!.id);
  store.clearBots();
  assert.equal(store.listBots().length, 0);
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

test("statusText blijft staan als pauze afloopt", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 8 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "pauze", "arrest");
  assert.equal(a.user.statusText, "arrest");
  a.user.pauseUntil = Date.now() - 1;
  const pauseEnded = store.nudgePauses();
  assert.equal(pauseEnded.length, 1);
  assert.equal(pauseEnded[0].status, "pauze");
  assert.equal(pauseEnded[0].pauseUntil, 0);
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
    guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } })
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
  const a = store.join(guest({ deskId: 16 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "pauze");
  store.setTyping(a.user.id, true);
  assert.equal(a.user.typing, true);
  store.setStatus(a.user.id, "studeren");
  const typing = store.setTyping(a.user.id, true);
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
  store.stand(a.user.id);
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

test("publicUser lekt geen type-draft", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "kennismaken");
  a.user.draft = "geheim bericht dat ik nog niet verstuur";
  const pub = store.publicUser(a.user);
  assert.equal("draft" in pub, false);
  const typing = store.setTyping(a.user.id, true);
  assert.equal(typing?.typing, true);
  assert.equal("draft" in (typing || {}), false);
  assert.equal(a.user.draft, "");
});

test("chatgeschiedenis bij reconnect bevat geen proximity-berichten", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken", "");
  const near = store.addChat(a.user, "alleen voor wie naast me zit", "speak");
  const tent = store.addChat(a.user, "hele tent hoort dit", "shout");
  assert.ok("msg" in near);
  assert.ok("msg" in tent);
  const history = store.chatHistoryFor(b.user.id);
  assert.equal(history.some((m) => m.text.includes("naast me")), false);
  assert.equal(history.some((m) => m.text.includes("hele tent")), true);
});

test("logout wist privéberichten uit het geheugen", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  const sent = store.addDm(a.user, b.user.id, "niet bewaren na logout");
  assert.ok("msg" in sent);
  assert.equal(store.getDms(a.user.id, b.user.id).length, 1);
  store.logout(a.user.sid);
  assert.equal(store.getDms(a.user.id, b.user.id).length, 0);
});

test("kick blokkeert dezelfde naam en leeftijd", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
  store.kick(a.user.id);
  const again = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 3 }));
  assert.ok("error" in again);
});

test("avatar weigert HTML die zich als jpeg voordoet", () => {
  const fake = `data:image/jpeg;base64,${Buffer.from("<html>xss</html>").toString("base64")}`;
  assert.ok("error" in parseAvatar({ dataUrl: fake }));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  assert.equal(sniffImageMime(jpeg), "image/jpeg");
  const ok = parseAvatar({ dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  assert.equal("kind" in ok && ok.kind, "photo");
});

test("COOKIE_SECRET is verplicht in productie", () => {
  assert.equal(requireCookieSecret(false, undefined), "blokbar-dev-secret-change-me");
  assert.throws(() => requireCookieSecret(true, undefined));
  assert.throws(() => requireCookieSecret(true, "blokbar-dev-secret-change-me"));
  assert.equal(requireCookieSecret(true, "festival-geheim"), "festival-geheim");
});

test("cookies zijn Secure in productie tenzij uitgezet", () => {
  assert.equal(cookieSecure(true, undefined), true);
  assert.equal(cookieSecure(true, "false"), false);
  assert.equal(cookieSecure(false, undefined), false);
  assert.equal(cookieSecure(false, "true"), true);
});

test("host-pin vergelijking is constant-time en rate-limit sluit af", () => {
  assert.equal(timingSafeEqualString("1234", "1234"), true);
  assert.equal(timingSafeEqualString("1234", "1235"), false);
  assert.equal(timingSafeEqualString("12", "1234"), false);
  const limit = createRateLimit(60_000, 2);
  assert.equal(limit.allow("ip"), true);
  assert.equal(limit.allow("ip"), true);
  assert.equal(limit.allow("ip"), false);
});

test("zwaai is een emoji, geen chatbericht", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 21 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "kennismaken");
  const waved = store.wave(a.user.id, "👋");
  assert.ok("user" in waved);
  assert.equal(waved.user.bubble, "👋");
  assert.equal(waved.user.waving, "👋");
  assert.equal(store.chatHistory().length, 0);
  assert.ok("error" in validateWave("🔥"));
  const again = store.wave(a.user.id, "☕");
  assert.ok("error" in again);
});

test("blokkeren stopt DM en speeddate", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken");
  store.setStatus(b.user.id, "kennismaken");
  store.block(a.user.id, b.user.id);
  assert.ok("error" in store.addDm(a.user, b.user.id, "nee"));
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const { started } = store.matchDates();
  assert.equal(started.length, 0);
  assert.ok("reason" in validateReportReason("Lastigvallen"));
  assert.ok("error" in validateReportReason("spam"));
});

test("pauze loopt af zonder teleport; verlengen of kennismaken", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 22 }));
  if (!("user" in a)) throw new Error("expected user");
  store.stand(a.user.id);
  const loungeX = a.user.x;
  a.user.pauseUntil = Date.now() - 1;
  const nudged = store.nudgePauses();
  assert.equal(nudged.length, 1);
  assert.equal(a.user.status, "pauze");
  assert.equal(a.user.pauseUntil, 0);
  assert.equal(a.user.x, loungeX);
  store.extendPause(a.user.id);
  assert.ok((a.user.pauseUntil || 0) > Date.now());
  store.hangOut(a.user.id);
  assert.equal(a.user.status, "kennismaken");
  assert.equal(a.user.x, loungeX);
});

test("speeddate verder chatten: ja/ja houdt DM, nee wist hem", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ firstName: "Adam", lastName: "Aerts", deskId: 1 }));
  const b = store.join(guest({ firstName: "Britt", lastName: "Beelen", deskId: 2, avatar: { kind: "preset" as const, preset: 2 } }));
  if (!("user" in a) || !("user" in b)) throw new Error("expected users");
  store.connect(a.user.id, "s1");
  store.connect(b.user.id, "s2");
  store.setStatus(a.user.id, "kennismaken");
  store.setStatus(b.user.id, "kennismaken");
  store.joinQueue(a.user.id);
  store.joinQueue(b.user.id);
  const t0 = Date.now();
  const { started } = store.matchDates(t0);
  assert.equal(started.length, 1);
  store.addDm(a.user, b.user.id, "bewaar dit");
  store.matchDates(t0 + 3 * 60 * 1000);
  const pending = store.answerContinue(a.user.id, true);
  assert.ok("pending" in pending);
  const both = store.answerContinue(b.user.id, true);
  assert.ok("keep" in both && both.keep);
  assert.equal(store.getDms(a.user.id, b.user.id).length, 1);
});

test("ijsbrekers werken aan de bar en op het profiel", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 23 }));
  if (!("user" in a)) throw new Error("expected user");
  store.setStatus(a.user.id, "kennismaken");
  const bar = store.sayIce(a.user.id, "bar");
  assert.ok("text" in bar);
  assert.ok(ICEBREAKERS.includes(bar.text));
  assert.equal(a.user.bubble, bar.text);
});

test("dagkaart, schoolhoekjes en onboarding", () => {
  const world = createWorld();
  assert.equal(world.schoolCorners.length, 4);
  assert.equal(schoolCornerAt(world, 80, 1700)?.label, "PXL");
  const store = createStore(world);
  const board = store.setBoard({ slotId: "koffie" });
  assert.equal(board.title, "Koffie");
  const moment = store.setBoard({ moment: "Iedereen even rechtstaan" });
  assert.equal(moment.moment, "Iedereen even rechtstaan");
  const a = store.join(guest({ deskId: 24 }));
  if (!("user" in a)) throw new Error("expected user");
  store.connect(a.user.id, "s1");
  assert.ok(store.zoneOccupancy().some((z) => z.id === "study"));
  assert.match(onboardText(42), /bureau 42/);
});

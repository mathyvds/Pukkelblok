import test from "node:test";
import assert from "node:assert/strict";
import { validateNames, parseAvatar, validateChat, shirtColor, sniffImageMime } from "../src/shared/validate";
import { createWorld, clampMove, deskById, PLAYER_R } from "../src/shared/world";
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

test("publicUser lekt geen type-draft", () => {
  const store = createStore(createWorld());
  const a = store.join(guest({ deskId: 1 }));
  if (!("user" in a)) throw new Error("expected user");
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
  const near = store.addChat(a.user, "alleen voor wie naast me zit", "near");
  const tent = store.addChat(a.user, "hele tent hoort dit", "tent");
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

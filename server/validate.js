import { DESK_COUNT } from "./world.js";

const NAME_RE = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;

export const MAX_ONLINE = 100;
export const MAX_AVATAR_BYTES = 100_000;
export const MAX_CHAT = 200;
export const MAX_STATUS = 60;
export const CHAT_COOLDOWN_MS = 700;
export const SHOUT_COOLDOWN_MS = 60_000;

export const STUDIES = [
  "Rechten",
  "Geneeskunde",
  "Psychologie",
  "Economie / TEW",
  "Handelsingenieur",
  "Ingenieurswetenschappen",
  "Informatica",
  "Taal- en letterkunde",
  "Politieke wetenschappen",
  "Onderwijs",
  "Andere",
];

export function cleanName(value, max) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateNames(firstName, lastName) {
  const first = cleanName(firstName, 24);
  const last = cleanName(lastName, 40);
  if (first.length < 2) return { error: "Vul je voornaam in (minstens 2 letters)." };
  if (last.length < 2) return { error: "Vul je familienaam in (minstens 2 letters)." };
  if (!NAME_RE.test(first)) return { error: "Voornaam mag alleen letters, spaties of koppeltekens bevatten." };
  if (!NAME_RE.test(last)) return { error: "Familienaam mag alleen letters, spaties of koppeltekens bevatten." };
  return { firstName: first, lastName: last };
}

export function validateStatus(status) {
  const allowed = new Set(["blokken", "pauze", "kennismaken"]);
  return allowed.has(status) ? status : "kennismaken";
}

export function validateStudy(value) {
  const study = String(value || "").trim();
  if (!study) return { study: "" };
  if (!STUDIES.includes(study)) return { error: "Kies een vakgebied uit de lijst." };
  return { study };
}

export function validateDeskId(id) {
  const deskId = Number(id);
  if (!Number.isInteger(deskId) || deskId < 1 || deskId > DESK_COUNT) {
    return { error: `Kies bureau 1 tot ${DESK_COUNT}.` };
  }
  return { deskId };
}

export function validateChat(text) {
  const msg = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT);
  if (!msg) return { error: "Leeg bericht." };
  return { text: msg };
}

export function parseAvatar(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Kies of maak een avatar." };
  }
  if (payload.preset) {
    const n = Number(payload.preset);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      return { error: "Onbekende avatar." };
    }
    return { kind: "preset", preset: n };
  }
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return { error: "Upload een foto (JPG, PNG of WebP) of kies een look." };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return { error: "De foto is leeg." };
  if (buffer.length > MAX_AVATAR_BYTES) {
    return { error: "Foto is te groot. Gebruik een kleinere foto." };
  }
  const mime = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  return { kind: "photo", buffer, mime: `image/${mime}` };
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function shirtColor(seed) {
  const colors = ["#E91E8C", "#F5C518", "#FF6B35", "#2A9D8F", "#7B2CBF", "#E63946", "#457B9D", "#118AB2"];
  let hash = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

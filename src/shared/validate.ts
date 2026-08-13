import { MAX_AVATAR_BYTES, MAX_CHAT, MAX_ONLINE, statuses, type Status } from "./protocol";

export { MAX_ONLINE, MAX_AVATAR_BYTES, MAX_CHAT };

const NAME_RE = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;

export type NameOk = { firstName: string; lastName: string };
export type ChatOk = { text: string };
export type AvatarPreset = { kind: "preset"; preset: number };
export type AvatarPhoto = { kind: "photo"; buffer: Buffer; mime: string };
export type Fail = { error: string };

export function cleanName(value: unknown, max: number) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function validateNames(firstName: unknown, lastName: unknown): NameOk | Fail {
  const first = cleanName(firstName, 24);
  const last = cleanName(lastName, 40);
  if (first.length < 2) return { error: "Vul je voornaam in (minstens 2 letters)." };
  if (last.length < 2) return { error: "Vul je familienaam in (minstens 2 letters)." };
  if (!NAME_RE.test(first)) return { error: "Voornaam mag alleen letters, spaties of koppeltekens bevatten." };
  if (!NAME_RE.test(last)) return { error: "Familienaam mag alleen letters, spaties of koppeltekens bevatten." };
  return { firstName: first, lastName: last };
}

export function validateStatus(status: unknown): Status {
  return statuses.includes(status as Status) ? (status as Status) : "kennismaken";
}

export function validateChat(text: unknown): ChatOk | Fail {
  const msg = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT);
  if (!msg) return { error: "Leeg bericht." };
  return { text: msg };
}

export function parseAvatar(payload: unknown): AvatarPreset | AvatarPhoto | Fail {
  if (!payload || typeof payload !== "object") {
    return { error: "Kies of maak een avatar." };
  }
  const data = payload as { preset?: unknown; dataUrl?: unknown };
  if (data.preset) {
    const n = Number(data.preset);
    if (!Number.isInteger(n) || n < 1 || n > 8) return { error: "Onbekende avatar." };
    return { kind: "preset", preset: n };
  }
  const dataUrl = String(data.dataUrl || "");
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

export function escapeHtml(text: string) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function shirtColor(seed: string) {
  const colors = ["#FFE600", "#FF3B8B", "#111111", "#FF6B00", "#2A9D8F", "#7B2CBF", "#E63946", "#118AB2"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

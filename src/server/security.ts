import crypto from "node:crypto";

export const DEV_COOKIE_SECRET = "blokbar-dev-secret-change-me";

export function requireCookieSecret(isProd: boolean, value: string | undefined) {
  const secret = String(value || "").trim();
  if (isProd && (!secret || secret === DEV_COOKIE_SECRET)) {
    throw new Error("COOKIE_SECRET is verplicht in productie en mag niet de dev-default zijn.");
  }
  return secret || DEV_COOKIE_SECRET;
}

export function cookieSecure(isProd: boolean, flag: string | undefined) {
  if (flag === "true") return true;
  if (flag === "false") return false;
  return isProd;
}

export function timingSafeEqualString(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function createRateLimit(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();

  function allow(key: string, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  function retryAfterSec(key: string, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (!recent.length) return 0;
    return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
  }

  return { allow, retryAfterSec };
}

export function clientKey(req: { ip?: string; socket?: { remoteAddress?: string } }) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

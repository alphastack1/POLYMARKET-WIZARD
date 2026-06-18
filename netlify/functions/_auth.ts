import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import { getBotAddress } from "./_wallet";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const appName = "Polymarket Wizard";

type ChallengeRecord = {
  address: string;
  message: string;
  expiresAt: number;
};

type SessionPayload = {
  address: string;
  exp: number;
};

export async function createAuthChallenge(address: string) {
  const normalized = normalizeAddress(address);
  if (!isAllowedWallet(normalized)) throw new Error("This wallet is not allowed to control the Wizard.");

  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const message = [
    `${appName} access request`,
    "",
    "Sign this message to unlock the guarded trading console.",
    "This does not submit a transaction or spend funds.",
    "",
    `Wallet: ${normalized}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");

  const store = getStore("bot-auth");
  await store.setJSON(challengeKey(nonce), { address: normalized, message, expiresAt } satisfies ChallengeRecord, {
    metadata: { expiresAt: String(expiresAt) },
  });

  return { nonce, message, expiresAt };
}

export async function verifyAuthChallenge(params: { address: string; nonce: string; signature: string }) {
  const normalized = normalizeAddress(params.address);
  if (!isAllowedWallet(normalized)) throw new Error("This wallet is not allowed to control the Wizard.");

  const store = getStore("bot-auth");
  const key = challengeKey(params.nonce);
  const challenge = await store.get(key, { type: "json" }) as ChallengeRecord | null;
  await store.delete(key).catch(() => undefined);

  if (!challenge) throw new Error("Login challenge expired. Try again.");
  if (challenge.expiresAt < Date.now()) throw new Error("Login challenge expired. Try again.");
  if (normalizeAddress(challenge.address) !== normalized) throw new Error("Wallet changed during login.");

  const ok = await verifyMessage({
    address: normalized as `0x${string}`,
    message: challenge.message,
    signature: params.signature as `0x${string}`,
  });
  if (!ok) throw new Error("Signature did not match the connected wallet.");

  const payload: SessionPayload = {
    address: normalized,
    exp: Date.now() + SESSION_TTL_MS,
  };

  return {
    address: normalized,
    expiresAt: payload.exp,
    token: signSession(payload),
  };
}

export function requireAuth(req: Request) {
  const token = getBearer(req);
  if (!token) throw new Error("Connect the Wizard wallet first.");

  const payload = verifySession(token);
  if (!isAllowedWallet(payload.address)) throw new Error("This wallet is not allowed to control the Wizard.");
  return payload;
}

export function optionalAuth(req: Request) {
  const token = getBearer(req);
  if (!token) return null;
  try {
    return requireAuth(req);
  } catch {
    return null;
  }
}

export function allowedWallets() {
  const configured = (process.env.AUTH_ALLOWED_WALLETS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeAddress(item));

  if (configured.length) return configured;

  try {
    return [normalizeAddress(getBotAddress())];
  } catch {
    return [];
  }
}

function verifySession(token: string): SessionPayload {
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) throw new Error("Invalid session.");

  const expected = hmac(payloadPart);
  if (!safeEqual(expected, sigPart)) throw new Error("Invalid session.");

  const payload = JSON.parse(fromBase64Url(payloadPart)) as SessionPayload;
  payload.address = normalizeAddress(payload.address);
  if (payload.exp < Date.now()) throw new Error("Session expired. Connect again.");

  return payload;
}

function signSession(payload: SessionPayload) {
  const payloadPart = toBase64Url(JSON.stringify(payload));
  return `${payloadPart}.${hmac(payloadPart)}`;
}

function hmac(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.BOT_MNEMONIC || process.env.POLYMARKET_CLOB_SECRET || "dev-only-auth-secret";
}

function getBearer(req: Request) {
  const header = req.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function isAllowedWallet(address: string) {
  return allowedWallets().includes(normalizeAddress(address));
}

function normalizeAddress(address: string) {
  return getAddress(address);
}

function challengeKey(nonce: string) {
  return `challenge:${nonce}`;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

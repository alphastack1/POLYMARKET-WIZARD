import crypto from "node:crypto";
import { error, json } from "./_env";
import { rateLimit } from "./_rate";

const CLOB_BASE = "https://clob.polymarket.com";

type ClobCreds = {
  key?: string;
  secret?: string;
  passphrase?: string;
};

type ClobOrderPayload = {
  order?: Record<string, unknown>;
  owner?: string;
  orderType?: string;
  deferExec?: boolean;
  postOnly?: boolean;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") return error("Use POST", 405);
  if (process.env.PUBLIC_APP_DISABLED === "true") {
    return error("Trading is temporarily disabled. Withdrawals remain available.", 503);
  }
  const limited = rateLimit(req, 30, 60_000);
  if (!limited.ok) return error("Too many trade requests", 429);

  const body = await req.json().catch(() => ({}));
  const clobPayload = body.clobPayload as ClobOrderPayload | undefined;
  const clobCreds = body.clobCreds as ClobCreds | undefined;
  const polyAddress = String(body.polyAddress || "");

  if (!polyAddress.startsWith("0x")) return error("Missing CLOB auth wallet address");
  if (!clobPayload?.order || !clobPayload.order.signature) return error("Missing signed order");
  if (!clobCreds?.key || !clobCreds.secret || !clobCreds.passphrase) {
    return error("Missing user CLOB credentials");
  }

  const requestPath = "/order";
  const payload = {
    deferExec: clobPayload.deferExec ?? false,
    postOnly: clobPayload.postOnly ?? false,
    order: clobPayload.order,
    owner: clobPayload.owner || clobCreds.key,
    orderType: clobPayload.orderType || "GTC",
  };
  const requestBody = JSON.stringify(payload);
  const headers = buildClobHeaders("POST", requestPath, requestBody, {
    key: clobCreds.key,
    secret: clobCreds.secret,
    passphrase: clobCreds.passphrase,
  }, polyAddress);

  const clobRes = await fetch(`${CLOB_BASE}${requestPath}`, {
    method: "POST",
    headers,
    body: requestBody,
  });
  const responseText = await clobRes.text();
  const data = parseJson(responseText);

  if (!clobRes.ok) {
    return error(String(data.error || data.message || responseText.slice(0, 300)), clobRes.status >= 500 ? 502 : clobRes.status);
  }

  return json({
    ok: true,
    orderId: String(data.orderID || data.orderId || data.id || "unknown"),
    status: String(data.status || "submitted"),
    txHashes: Array.isArray(data.transactionsHashes) ? data.transactionsHashes : [],
    clob: data,
  });
}

function buildClobHeaders(
  method: string,
  requestPath: string,
  body: string,
  creds: Required<ClobCreds>,
  polyAddress: string,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}${method}${requestPath}${body}`;
  const signature = crypto
    .createHmac("sha256", Buffer.from(creds.secret.replace(/-/g, "+").replace(/_/g, "/"), "base64"))
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    POLY_ADDRESS: polyAddress,
    POLY_API_KEY: creds.key,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_PASSPHRASE: creds.passphrase,
    "Content-Type": "application/json",
  };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

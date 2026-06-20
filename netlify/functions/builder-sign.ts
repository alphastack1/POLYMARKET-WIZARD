import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { error, json } from "./_env";
import { rateLimit } from "./_rate";

export default async function handler(req: Request) {
  if (req.method !== "POST") return error("Use POST", 405);
  const limited = rateLimit(req, 120, 60_000);
  if (!limited.ok) return error("Too many requests", 429);

  const body = await req.json().catch(() => ({}));
  const method = String(body.method || "");
  const path = String(body.path || "");
  const requestBody = typeof body.body === "string" ? body.body : undefined;
  const timestamp = Number.isFinite(Number(body.timestamp)) ? Number(body.timestamp) : undefined;

  if (!method || !path) return error("Missing method/path");
  if (!path.startsWith("/")) return error("Invalid relayer path");

  const key = process.env.POLYMARKET_BUILDER_API_KEY || "";
  const secret = process.env.POLYMARKET_BUILDER_SECRET || "";
  const passphrase = process.env.POLYMARKET_BUILDER_PASSPHRASE || "";
  if (!key || !secret || !passphrase) {
    return error("Builder credentials are not configured", 503);
  }

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key,
      secret,
      passphrase,
    },
  });

  if (!builderConfig.isValid()) return error("Builder credentials are not configured", 503);
  const headers = await builderConfig.generateBuilderHeaders(method, path, requestBody, timestamp);
  if (!headers) return error("Could not sign builder request", 500);
  return json(headers);
}

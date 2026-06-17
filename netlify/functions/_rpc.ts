export function getPolygonRpcUrls() {
  return [
    process.env.POLYGON_RPC_URL,
    ...(process.env.POLYGON_RPC_FALLBACKS || "").split(","),
  ].filter(Boolean) as string[];
}

export async function rpcFetch(body: unknown) {
  let lastError: unknown;

  for (const url of getPolygonRpcUrls()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return res.json();
      lastError = new Error(`${url} returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("All Polygon RPC URLs failed");
}

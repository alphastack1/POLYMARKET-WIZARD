export async function callApi<T>(name: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: { error?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("API functions are not available. Run with Netlify dev or open the deployed Netlify app.");
  }

  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }

  return data as T;
}

function sessionToken() {
  try {
    const raw = localStorage.getItem("wizardSession");
    const session = raw ? JSON.parse(raw) as { token?: string; expiresAt?: number } : null;
    if (!session?.token || !session.expiresAt || session.expiresAt < Date.now()) {
      localStorage.removeItem("wizardSession");
      localStorage.removeItem("wizardSessionToken");
      return "";
    }
    localStorage.setItem("wizardSessionToken", session.token);
    return session.token;
  } catch {
    localStorage.removeItem("wizardSession");
    localStorage.removeItem("wizardSessionToken");
    return "";
  }
}

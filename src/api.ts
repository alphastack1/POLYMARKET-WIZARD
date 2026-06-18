export async function callApi<T>(name: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("wizardSessionToken");
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }

  return data as T;
}

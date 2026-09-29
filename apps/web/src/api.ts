const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: devHeaders()
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...devHeaders(),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

function devHeaders() {
  return {
    "x-org-slug": "acme",
    "x-user-email": "owner@acme.test"
  };
}

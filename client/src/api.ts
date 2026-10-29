const TOKEN_KEY = 'ftx_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(input, {
    cache: 'no-store',
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

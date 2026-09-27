const ACCESS_TOKEN_STORAGE_KEY = 'knowledge-hub.access-token';

let accessToken: string | null = null;

function isExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;

    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return typeof decoded.exp !== 'number' || decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function getAccessToken() {
  if (accessToken && !isExpired(accessToken)) return accessToken;

  accessToken = null;
  if (typeof window === 'undefined') return null;

  const storedToken = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (!storedToken || isExpired(storedToken)) {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    return null;
  }

  accessToken = storedToken;
  return accessToken;
}

export function setAccessToken(token: string) {
  accessToken = token;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  }
}

export function clearAccessToken() {
  accessToken = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  }
}

const REMEMBERED_LOGIN_STORAGE_KEY = 'knowledge-hub.remembered-login';

interface RememberedLogin {
  username: string;
  password: string;
}

export function getRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;

  try {
    const value = window.localStorage.getItem(REMEMBERED_LOGIN_STORAGE_KEY);
    if (!value) return null;

    const credentials = JSON.parse(value) as Partial<RememberedLogin>;
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') {
      throw new Error('Invalid remembered login');
    }

    return { username: credentials.username, password: credentials.password };
  } catch {
    window.localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
    return null;
  }
}

export function saveRememberedLogin(credentials: RememberedLogin | null) {
  if (typeof window === 'undefined') return;

  if (credentials) {
    window.localStorage.setItem(REMEMBERED_LOGIN_STORAGE_KEY, JSON.stringify(credentials));
  } else {
    window.localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
  }
}

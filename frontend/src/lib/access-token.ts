// Access token deliberately lives only for the lifetime of this JS context.
// Do not persist it in browser storage or a readable cookie.
let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

import { apiClient } from '@/lib/api-client';
import { LoginRequest, LoginResponse, User } from '@/types/api.types';

const LOGIN_RSA_PUBLIC_KEY_BASE64 =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFyc1VTcDd6RjRhMlRJcmxieHRkcgp5Z2o4czBoVTZxaTEyV2VDSk04N05vOTIxdGtZSVl5dVhRdzdDdFU1c05RdlI0cjRRM2t3ZlRSVUh3VXZTbGlVCnF2bmwyaDZLZFBpTjlWRlVvdHVGZmNsTVpDZzRsSm1abDJjREVtVlhGZWtVOURhQ3JKcHRwOUZIcFppc29ENEkKcUNxZjU2cnJ0ZkJKRDJxWjRsY2VUSjI1NEVCM2k5QmJXS1R3QzUzZ1dkYmdTMDRLcjVXWEtwV1NTbE1aSjJ6LwpkbWtoOFFCZmV5K0EySnovaEhDTDBnd1ZjYjZBdFVFb2VNZVJ3dDZjV3paekRCNUR4OEtHZTlYamNDOG9FeUUwClliWUh2VFRIMU1lbGpzdUlNMlJJcGUrUFY0eVlic3grdEpqcUJwdUtLNTBFODdXcTd3SVdvTzcxYVhGTHhBZ3YKOVFJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==';

function getFixedPublicKey(): ArrayBuffer {
  const pem = atob(LOGIN_RSA_PUBLIC_KEY_BASE64);
  const base64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  const der = atob(base64);
  const bytes = new Uint8Array(der.length);
  for (let index = 0; index < der.length; index += 1) {
    bytes[index] = der.charCodeAt(index);
  }
  return bytes.buffer;
}

async function encryptPassword(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'spki',
    getFixedPublicKey(),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(password),
  );

  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

/**
 * 认证服务
 */
export const authService = {
  /**
   * 登录
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    return apiClient.post<LoginResponse>('/auth/login', {
      ...request,
      password: await encryptPassword(request.password),
    }, { skipUnauthorizedRedirect: true });
  },

  /**
   * 获取当前用户信息
   */
  async getProfile(): Promise<User> {
    return apiClient.get<User>('/auth/profile');
  },
};

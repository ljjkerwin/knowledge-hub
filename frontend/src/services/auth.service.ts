import { apiClient } from '@/lib/api-client';
import { LoginRequest, LoginResponse, User } from '@/types/api.types';
import forge from 'node-forge';

const LOGIN_RSA_PUBLIC_KEY_BASE64 =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFyc1VTcDd6RjRhMlRJcmxieHRkcgp5Z2o4czBoVTZxaTEyV2VDSk04N05vOTIxdGtZSVl5dVhRdzdDdFU1c05RdlI0cjRRM2t3ZlRSVUh3VXZTbGlVCnF2bmwyaDZLZFBpTjlWRlVvdHVGZmNsTVpDZzRsSm1abDJjREVtVlhGZWtVOURhQ3JKcHRwOUZIcFppc29ENEkKcUNxZjU2cnJ0ZkJKRDJxWjRsY2VUSjI1NEVCM2k5QmJXS1R3QzUzZ1dkYmdTMDRLcjVXWEtwV1NTbE1aSjJ6LwpkbWtoOFFCZmV5K0EySnovaEhDTDBnd1ZjYjZBdFVFb2VNZVJ3dDZjV3paekRCNUR4OEtHZTlYamNDOG9FeUUwClliWUh2VFRIMU1lbGpzdUlNMlJJcGUrUFY0eVlic3grdEpqcUJwdUtLNTBFODdXcTd3SVdvTzcxYVhGTHhBZ3YKOVFJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==';

async function encryptPassword(password: string): Promise<string> {
  // node-forge is a pure-JavaScript implementation, so it also works when
  // an HTTP page has no Web Crypto (`crypto.subtle`) support.
  const publicKey = forge.pki.publicKeyFromPem(atob(LOGIN_RSA_PUBLIC_KEY_BASE64));
  const encrypted = publicKey.encrypt(password, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });

  return forge.util.encode64(encrypted);
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

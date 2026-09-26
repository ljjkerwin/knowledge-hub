import { ConfigService } from '@nestjs/config';
import { AuthorizationCacheService } from './authorization-cache.service';
import { RoleCode } from './entities/role.entity';

describe('AuthorizationCacheService', () => {
  const config = {
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
  } as ConfigService;

  it('uses L1 after the first database fallback and clears it on invalidation', async () => {
    const cache = new AuthorizationCacheService(config);
    const loader = jest.fn().mockResolvedValue({
      id: '10001',
      username: 'dev',
      roles: [RoleCode.User],
    });

    await expect(cache.get('10001', loader)).resolves.toEqual({
      id: '10001',
      username: 'dev',
      roles: [RoleCode.User],
    });
    await cache.get('10001', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.invalidate('10001');
    await cache.get('10001', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry when L1 reaches its configured limit', async () => {
    const limitedConfig = {
      get: <T>(key: string, fallback?: T): T | undefined =>
        (key === 'AUTHZ_L1_MAX_ENTRIES' ? '2' : fallback) as T | undefined,
    } as ConfigService;
    const cache = new AuthorizationCacheService(limitedConfig);
    const loader = jest.fn((id: string) =>
      Promise.resolve({ id, username: id, roles: [RoleCode.User] }),
    );

    await cache.get('1', () => loader('1'));
    await cache.get('2', () => loader('2'));
    await cache.get('1', () => loader('1')); // 将 1 提升为最近使用
    await cache.get('3', () => loader('3')); // 淘汰 2
    await cache.get('2', () => loader('2'));

    expect(loader).toHaveBeenCalledTimes(4);
  });
});

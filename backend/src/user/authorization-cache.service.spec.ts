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
});

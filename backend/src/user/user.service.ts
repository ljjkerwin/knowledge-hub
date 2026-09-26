import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { RoleCode, RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import {
  AuthorizationCacheService,
  AuthorizationSnapshot,
} from './authorization-cache.service';

export type UserWithRoles = UserEntity & { roles: RoleCode[] };

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    private readonly authorizationCache: AuthorizationCacheService,
  ) {}

  async findByUsername(username: string): Promise<UserWithRoles | null> {
    const user = await this.userRepo.findOne({
      where: { username, deleted: false },
    });
    return user ? this.withRoles(user) : null;
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    const user = await this.userRepo.findOne({ where: { id, deleted: false } });
    return user ? this.withRoles(user) : null;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.userRepo.update(id, { passwordHash });
  }

  /**
   * 供 JWT 守卫使用的最小授权上下文。
   * 授权链为 L1 内存 → Redis L2 → PostgreSQL，不在每个请求直接查询数据库。
   */
  async findAuthorizationById(
    id: string,
  ): Promise<AuthorizationSnapshot | null> {
    return this.authorizationCache.get(id, async () => {
      const user = await this.userRepo.findOne({
        select: { id: true, username: true },
        where: { id, deleted: false },
      });
      if (!user) return null;

      return {
        id: user.id,
        username: user.username,
        roles: await this.findRoleCodes(user.id),
      };
    });
  }

  /** 角色变更、用户禁用或删除后调用，通知集群清理授权快照。 */
  async invalidateAuthorization(id: string): Promise<void> {
    await this.authorizationCache.invalidate(id);
  }

  private async withRoles(user: UserEntity): Promise<UserWithRoles> {
    return Object.assign(user, { roles: await this.findRoleCodes(user.id) });
  }

  private async findRoleCodes(userId: string): Promise<RoleCode[]> {
    const rows = await this.roleRepo
      .createQueryBuilder('role')
      .innerJoin(
        UserRoleEntity,
        'userRole',
        'userRole.role_id = role.id AND userRole.user_id = :userId',
        { userId },
      )
      .where('role.status = :status', { status: 1 })
      .select('role.role_code', 'roleCode')
      .getRawMany<{ roleCode: RoleCode }>();

    return rows.map(({ roleCode }) => roleCode);
  }
}

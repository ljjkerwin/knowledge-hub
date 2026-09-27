import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserEntity, UserStatus } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { TeamEntity } from '../team/entities/team.entity';
import { TeamMemberEntity } from '../team/entities/team-member.entity';
import { TeamRoleEntity } from '../team/entities/team-role.entity';
import {
  AuthorizationCacheService,
  AuthorizationSnapshot,
} from './authorization-cache.service';

export type UserWithRoles = UserEntity & {
  roles: string[];
  permissions: string[];
};

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(TeamEntity) private readonly teamRepo: Repository<TeamEntity>,
    @InjectRepository(TeamMemberEntity) private readonly teamMemberRepo: Repository<TeamMemberEntity>,
    @InjectRepository(TeamRoleEntity) private readonly teamRoleRepo: Repository<TeamRoleEntity>,
    private readonly authorizationCache: AuthorizationCacheService,
  ) {}

  async findByUsername(username: string): Promise<UserWithRoles | null> {
    const user = await this.userRepo.findOne({
      where: { username, deleted: false, status: UserStatus.Active },
    });
    return user ? this.withRoles(user) : null;
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    const user = await this.userRepo.findOne({
      where: { id, deleted: false, status: UserStatus.Active },
    });
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
        where: { id, deleted: false, status: UserStatus.Active },
      });
      if (!user) return null;

      return {
        id: user.id,
        username: user.username,
        roles: await this.findRoleCodes(user.id),
        permissions: await this.findPermissionCodes(user.id),
      };
    });
  }

  /** 角色变更、用户禁用或删除后调用，通知集群清理授权快照。 */
  async invalidateAuthorization(id: string): Promise<void> {
    await this.authorizationCache.invalidate(id);
  }

  private async withRoles(user: UserEntity): Promise<UserWithRoles> {
    const [roles, permissions] = await Promise.all([
      this.findRoleCodes(user.id),
      this.findPermissionCodes(user.id),
    ]);
    return Object.assign(user, { roles, permissions });
  }

  private async findRoleCodes(userId: string): Promise<string[]> {
    const directRows = await this.roleRepo
      .createQueryBuilder('role')
      .innerJoin(
        UserRoleEntity,
        'userRole',
        'userRole.role_id = role.id AND userRole.user_id = :userId',
        { userId },
      )
      .where('role.status = :status', { status: 1 })
      .select('role.role_code', 'roleCode')
      .getRawMany<{ roleCode: string }>();

    const memberships = await this.teamMemberRepo.find({ where: { userId } });
    const teams = await this.teamRepo.find({ where: { deleted: false, status: 1 } });
    const parentById = new Map(teams.map((team) => [team.id, team.parentId]));
    const teamIds = new Set<string>();
    memberships.forEach(({ teamId }) => { let current: string | undefined = teamId; while (current && current !== '0' && !teamIds.has(current)) { teamIds.add(current); current = parentById.get(current); } });
    const teamRoles = teamIds.size ? await this.teamRoleRepo.find({ where: { teamId: In([...teamIds]) } }) : [];
    const inheritedIds = [...new Set(teamRoles.map((link) => link.roleId))];
    const inherited = inheritedIds.length ? await this.roleRepo.find({ where: { id: In(inheritedIds), status: 1 } }) : [];
    return [...new Set([...directRows.map(({ roleCode }) => roleCode), ...inherited.map((role) => role.roleCode)])];
  }

  private async findPermissionCodes(userId: string): Promise<string[]> {
    const roleCodes = await this.findRoleCodes(userId);
    if (!roleCodes.length) return [];
    const rows = await this.roleRepo
      .createQueryBuilder('role')
      .innerJoin(
        RolePermissionEntity,
        'rolePermission',
        'rolePermission.role_id = role.id',
      )
      .innerJoin(
        PermissionEntity,
        'permission',
        'permission.id = rolePermission.permission_id',
      )
      .where('role.status = :roleStatus', { roleStatus: 1 })
      .andWhere('role.role_code IN (:...roleCodes)', { roleCodes })
      .andWhere('permission.status = :permissionStatus', {
        permissionStatus: 1,
      })
      .andWhere('permission.deleted = false')
      .select('DISTINCT permission.permission_code', 'permissionCode')
      .getRawMany<{ permissionCode: string }>();

    return rows.map(({ permissionCode }) => permissionCode);
  }
}

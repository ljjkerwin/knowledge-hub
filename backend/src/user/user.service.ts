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

      // 同一个授权快照只计算一次有效角色，再据此查询权限。
      const roles = await this.findRoleCodes(user.id);
      return {
        id: user.id,
        username: user.username,
        roles,
        permissions: await this.findPermissionCodes(roles),
      };
    });
  }

  /** 角色变更、用户禁用或删除后调用，通知集群清理授权快照。 */
  async invalidateAuthorization(id: string): Promise<void> {
    await this.authorizationCache.invalidate(id);
  }

  private async withRoles(user: UserEntity): Promise<UserWithRoles> {
    // 登录、个人资料等入口也复用 L1/Redis 授权快照，避免重复计算部门继承链。
    const authorization = await this.findAuthorizationById(user.id);
    return Object.assign(user, {
      roles: authorization?.roles ?? [],
      permissions: authorization?.permissions ?? [],
    });
  }

  private async findRoleCodes(userId: string): Promise<string[]> {
    // 用户可被直接授予角色；这部分不受部门归属影响。
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

    // 数据库递归查询只返回该用户所在部门及其祖先，避免把整棵组织树加载到应用内存。
    const memberships = await this.teamMemberRepo.find({
      where: { userId },
      select: { teamId: true },
    });
    const memberTeamIds = [...new Set(memberships.map(({ teamId }) => teamId))];
    const ancestorRows = memberTeamIds.length
      ? await this.teamRepo.query<{ id: string }[]>(
          `WITH RECURSIVE team_ancestors AS (
             SELECT id, parent_id
             FROM kh_team
             WHERE id = ANY($1::bigint[]) AND deleted = false AND status = 1
             UNION
             SELECT parent.id, parent.parent_id
             FROM kh_team parent
             INNER JOIN team_ancestors child ON child.parent_id = parent.id
             WHERE parent.deleted = false AND parent.status = 1
           )
           SELECT DISTINCT id FROM team_ancestors`,
          [memberTeamIds],
        )
      : [];
    const teamIds = ancestorRows.map(({ id }) => String(id));

    // 查询所有命中部门绑定的角色。停用角色会在下一步过滤，避免继续参与鉴权。
    const teamRoles = teamIds.length
      ? await this.teamRoleRepo.find({ where: { teamId: In(teamIds) } })
      : [];
    const inheritedIds = [...new Set(teamRoles.map((link) => link.roleId))];

    const inherited = inheritedIds.length
      ? await this.roleRepo.find({
          where: { id: In(inheritedIds), status: 1 },
        })
      : [];

    // 合并个人角色和继承角色；角色编码去重后作为后续权限查询的依据。
    return [...new Set([...directRows.map(({ roleCode }) => roleCode), ...inherited.map((role) => role.roleCode)])];
  }

  private async findPermissionCodes(roleCodes: string[]): Promise<string[]> {
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

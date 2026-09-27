import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { PermissionEntity } from './entities/permission.entity';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { AuthorizationCacheService } from './authorization-cache.service';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly authorizationCache: AuthorizationCacheService,
  ) {}

  async listPermissions(): Promise<PermissionEntity[]> {
    return this.permissionRepo.find({
      where: { deleted: false },
      order: { sort: 'ASC', id: 'ASC' },
    });
  }

  async listRoles() {
    const [roles, links] = await Promise.all([
      this.roleRepo.find({ where: { status: 1 }, order: { id: 'ASC' } }),
      this.rolePermissionRepo.find(),
    ]);
    const permissionsByRole = new Map<string, string[]>();
    links.forEach((link) => {
      const ids = permissionsByRole.get(link.roleId) ?? [];
      ids.push(link.permissionId);
      permissionsByRole.set(link.roleId, ids);
    });
    return roles.map((role) => ({
      ...role,
      permissionIds: permissionsByRole.get(role.id) ?? [],
    }));
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[]) {
    const role = await this.roleRepo.findOne({
      where: { id: roleId, status: 1 },
    });
    if (!role) throw new NotFoundException('角色不存在或已禁用');

    const uniqueIds = [...new Set(permissionIds)];
    const permissions = uniqueIds.length
      ? await this.permissionRepo.find({
          where: { id: In(uniqueIds), deleted: false, status: 1 },
        })
      : [];
    if (permissions.length !== uniqueIds.length) {
      throw new NotFoundException('存在无效或已禁用的权限');
    }

    await this.rolePermissionRepo.manager.transaction(async (manager) => {
      await manager.delete(RolePermissionEntity, { roleId });
      if (uniqueIds.length) {
        await manager.insert(
          RolePermissionEntity,
          uniqueIds.map((permissionId) => ({
            id: nextSnowflakeId(),
            roleId,
            permissionId,
          })),
        );
      }
    });
    const affectedUsers = await this.userRoleRepo.find({ where: { roleId } });
    await Promise.all(
      affectedUsers.map(({ userId }) =>
        this.authorizationCache.invalidate(userId),
      ),
    );
    return { roleId, permissionIds: uniqueIds };
  }
}

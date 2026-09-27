import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async createRole(input: {
    roleName: string;
    roleCode: string;
    description?: string;
    permissionIds: string[];
  }) {
    const roleName = input.roleName.trim();
    const roleCode = input.roleCode.trim().toUpperCase();
    const description = input.description?.trim() || null;
    const permissionIds = await this.resolveLeafPermissionIds(
      input.permissionIds,
    );

    const exists = await this.roleRepo.exists({ where: { roleCode } });
    if (exists) throw new ConflictException('角色编码已存在');

    const role = await this.roleRepo.manager.transaction(async (manager) => {
      const role = manager.create(RoleEntity, {
        id: nextSnowflakeId(),
        roleName,
        roleCode,
        description,
        status: 1,
      });
      await manager.insert(RoleEntity, role);
      if (permissionIds.length) {
        await manager.insert(
          RolePermissionEntity,
          permissionIds.map((permissionId) => ({
            id: nextSnowflakeId(),
            roleId: role.id,
            permissionId,
          })),
        );
      }
      return role;
    });
    return { ...role, permissionIds };
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[]) {
    const role = await this.roleRepo.findOne({
      where: { id: roleId, status: 1 },
    });
    if (!role) throw new NotFoundException('角色不存在或已禁用');

    const uniqueIds = await this.resolveLeafPermissionIds(permissionIds);

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

  async createPermission(input: PermissionInput) {
    const permission = this.normalizePermission(input);
    await this.ensureParentValid(permission.parentId);
    if (
      await this.permissionRepo.exists({
        where: { permissionCode: permission.permissionCode },
      })
    ) {
      throw new ConflictException('权限编码已存在');
    }
    return this.permissionRepo.save(
      this.permissionRepo.create({ id: nextSnowflakeId(), ...permission }),
    );
  }

  async updatePermission(id: string, input: PermissionInput) {
    const existing = await this.permissionRepo.findOne({
      where: { id, deleted: false },
    });
    if (!existing) throw new NotFoundException('权限不存在或已删除');
    const permission = this.normalizePermission(input);
    await this.ensureParentValid(permission.parentId, id);
    if (
      permission.permissionCode !== existing.permissionCode &&
      (await this.permissionRepo.exists({
        where: { permissionCode: permission.permissionCode },
      }))
    ) {
      throw new ConflictException('权限编码已存在');
    }
    await this.permissionRepo.update(id, permission);
    return this.permissionRepo.findOneByOrFail({ id });
  }

  async deletePermission(id: string) {
    const permission = await this.permissionRepo.findOne({
      where: { id, deleted: false },
    });
    if (!permission) throw new NotFoundException('权限不存在或已删除');
    const [hasChildren, hasRoleLinks] = await Promise.all([
      this.permissionRepo.exists({ where: { parentId: id, deleted: false } }),
      this.rolePermissionRepo.exists({ where: { permissionId: id } }),
    ]);
    if (hasChildren) throw new BadRequestException('请先删除或迁移子权限');
    if (hasRoleLinks)
      throw new BadRequestException('该权限仍被角色授权，无法删除');
    await this.permissionRepo.update(id, { deleted: true, status: 0 });
    return { id };
  }

  private normalizePermission(input: PermissionInput) {
    return {
      parentId: input.parentId,
      permissionName: input.permissionName.trim(),
      permissionCode: input.permissionCode.trim(),
      permissionType: input.permissionType,
      menuUrl: input.menuUrl?.trim() || null,
      apiUrl: input.apiUrl?.trim() || null,
      method: input.method?.trim().toUpperCase() || null,
      icon: input.icon?.trim() || null,
      sort: input.sort,
      status: input.status,
    };
  }

  private async ensureParentValid(parentId: string, id?: string) {
    if (parentId === '0') return;
    if (parentId === id) throw new BadRequestException('上级权限不能是自身');
    const all = await this.permissionRepo.find({ where: { deleted: false } });
    if (!all.some((permission) => permission.id === parentId))
      throw new NotFoundException('上级权限不存在或已删除');
    if (!id) return;
    const childrenByParent = new Map<string, string[]>();
    all.forEach((permission) =>
      childrenByParent.set(permission.parentId, [
        ...(childrenByParent.get(permission.parentId) ?? []),
        permission.id,
      ]),
    );
    const descendants = new Set<string>();
    const visit = (currentId: string) =>
      (childrenByParent.get(currentId) ?? []).forEach((childId) => {
        descendants.add(childId);
        visit(childId);
      });
    visit(id);
    if (descendants.has(parentId))
      throw new BadRequestException('上级权限不能是当前权限的子级');
  }

  /** 父权限只用于树形组织；角色授权持久化为叶子权限，避免未来新增子项自动扩权。 */
  private async resolveLeafPermissionIds(
    permissionIds: string[],
  ): Promise<string[]> {
    const requestedIds = [...new Set(permissionIds)];
    if (!requestedIds.length) return [];
    const permissions = await this.permissionRepo.find({
      where: { deleted: false },
    });
    const permissionsById = new Map(
      permissions.map((permission) => [permission.id, permission]),
    );
    if (
      requestedIds.some(
        (id) =>
          !permissionsById.get(id) || permissionsById.get(id)?.status !== 1,
      )
    )
      throw new NotFoundException('存在无效或已禁用的权限');
    const childrenByParent = new Map<string, PermissionEntity[]>();
    permissions.forEach((permission) =>
      childrenByParent.set(permission.parentId, [
        ...(childrenByParent.get(permission.parentId) ?? []),
        permission,
      ]),
    );
    const leaves = new Set<string>();
    const visit = (permissionId: string) => {
      const children = childrenByParent.get(permissionId) ?? [];
      if (!children.length) leaves.add(permissionId);
      else
        children
          .filter((child) => child.status === 1)
          .forEach((child) => visit(child.id));
    };
    requestedIds.forEach(visit);
    return [...leaves];
  }
}

export interface PermissionInput {
  parentId: string;
  permissionName: string;
  permissionCode: string;
  permissionType: number;
  menuUrl?: string;
  apiUrl?: string;
  method?: string;
  icon?: string;
  sort: number;
  status: number;
}

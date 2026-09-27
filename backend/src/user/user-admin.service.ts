import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { AuthorizationCacheService } from './authorization-cache.service';
import { RoleEntity } from './entities/role.entity';
import { UserEntity, UserStatus } from './entities/user.entity';
import { UserRoleEntity } from './entities/user-role.entity';

export interface UserAdminInput {
  username: string;
  email: string;
  nickname?: string;
  phone?: string;
  status: UserStatus;
  roleIds: string[];
  password?: string;
}

@Injectable()
export class UserAdminService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly authorizationCache: AuthorizationCacheService,
  ) {}

  async list() {
    const [users, links, roles] = await Promise.all([
      this.userRepo.find({
        where: { deleted: false },
        order: { createdAt: 'DESC' },
      }),
      this.userRoleRepo.find(),
      this.roleRepo.find(),
    ]);
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const roleIdsByUser = new Map<string, string[]>();
    links.forEach((link) =>
      roleIdsByUser.set(link.userId, [
        ...(roleIdsByUser.get(link.userId) ?? []),
        link.roleId,
      ]),
    );
    return users.map(({ passwordHash: _passwordHash, ...user }) => {
      const roleIds = roleIdsByUser.get(user.id) ?? [];
      const userRoles = roleIds
        .map((id) => rolesById.get(id))
        .filter((role): role is RoleEntity => Boolean(role));
      return {
        ...user,
        roleIds,
        roleNames: userRoles.map((role) => role.roleName),
        roleCodes: userRoles.map((role) => role.roleCode),
      };
    });
  }

  async create(input: UserAdminInput, actorId: string) {
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    const [usernameExists, emailExists] = await Promise.all([
      this.userRepo.exists({ where: { username } }),
      this.userRepo.exists({ where: { email } }),
    ]);
    if (usernameExists) throw new ConflictException('用户名已存在');
    if (emailExists) throw new ConflictException('邮箱已存在');
    const roleIds = await this.validateRoleIds(input.roleIds);
    const passwordHash = await hash(input.password!, 10);
    const user = await this.userRepo.manager.transaction(async (manager) => {
      const user = manager.create(UserEntity, {
        id: nextSnowflakeId(),
        username,
        email,
        passwordHash,
        nickname: this.emptyToNull(input.nickname),
        phone: this.emptyToNull(input.phone),
        status: input.status,
        createBy: actorId,
        updateBy: actorId,
        deleted: false,
      });
      await manager.insert(UserEntity, user);
      await this.replaceRoles(manager, user.id, roleIds);
      return user;
    });
    return this.findOne(user.id);
  }

  async update(id: string, input: UserAdminInput, actorId: string) {
    const user = await this.userRepo.findOne({ where: { id, deleted: false } });
    if (!user) throw new NotFoundException('用户不存在或已删除');
    const email = input.email.trim().toLowerCase();
    if (
      email !== user.email &&
      (await this.userRepo.exists({ where: { email } }))
    )
      throw new ConflictException('邮箱已存在');
    const roleIds = await this.validateRoleIds(input.roleIds);
    await this.userRepo.manager.transaction(async (manager) => {
      await manager.update(UserEntity, id, {
        email,
        nickname: this.emptyToNull(input.nickname),
        phone: this.emptyToNull(input.phone),
        status: input.status,
        updateBy: actorId,
      });
      await this.replaceRoles(manager, id, roleIds);
    });
    await this.authorizationCache.invalidate(id);
    return this.findOne(id);
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) throw new ConflictException('不能删除当前登录用户');
    const user = await this.userRepo.findOne({ where: { id, deleted: false } });
    if (!user) throw new NotFoundException('用户不存在或已删除');
    await this.userRepo.manager.transaction(async (manager) => {
      await manager.update(UserEntity, id, {
        deleted: true,
        status: UserStatus.Disabled,
        updateBy: actorId,
      });
      await manager.delete(UserRoleEntity, { userId: id });
    });
    await this.authorizationCache.invalidate(id);
    return { id };
  }

  private async findOne(id: string) {
    const users = await this.list();
    const user = users.find((item) => item.id === id);
    if (!user) throw new NotFoundException('用户不存在或已删除');
    return user;
  }

  private async validateRoleIds(roleIds: string[]) {
    const uniqueIds = [...new Set(roleIds)];
    const roles = uniqueIds.length
      ? await this.roleRepo.find({ where: { id: In(uniqueIds), status: 1 } })
      : [];
    if (roles.length !== uniqueIds.length)
      throw new NotFoundException('存在无效或已禁用的角色');
    return uniqueIds;
  }

  private async replaceRoles(
    manager: Repository<UserEntity>['manager'],
    userId: string,
    roleIds: string[],
  ) {
    await manager.delete(UserRoleEntity, { userId });
    if (roleIds.length)
      await manager.insert(
        UserRoleEntity,
        roleIds.map((roleId) => ({ id: nextSnowflakeId(), userId, roleId })),
      );
  }

  private emptyToNull(value?: string) {
    return value?.trim() || null;
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { UserEntity, UserStatus } from '../user/entities/user.entity';
import { RoleEntity } from '../user/entities/role.entity';
import { AuthorizationCacheService } from '../user/authorization-cache.service';
import { TeamRoleEntity } from './entities/team-role.entity';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamEntity } from './entities/team.entity';
import {
  TeamMemberEntity,
  TeamMemberRole,
} from './entities/team-member.entity';

type TeamMemberView = {
  id: string;
  userId: string;
  username: string;
  nickname?: string | null;
  memberRole: TeamMemberRole;
};

export type TeamTreeNode = TeamEntity & {
  leaderName?: string | null;
  members: TeamMemberView[];
  children: TeamTreeNode[];
};

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(TeamEntity)
    private readonly teamRepo: Repository<TeamEntity>,
    @InjectRepository(TeamMemberEntity)
    private readonly memberRepo: Repository<TeamMemberEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(TeamRoleEntity) private readonly teamRoleRepo: Repository<TeamRoleEntity>,
    private readonly authorizationCache: AuthorizationCacheService,
  ) {}

  async listTree(): Promise<TeamTreeNode[]> {
    const [teams, members] = await Promise.all([
      this.teamRepo.find({
        where: { deleted: false },
        order: { sort: 'ASC', id: 'ASC' },
      }),
      this.memberRepo.find(),
    ]);
    const userIds = [
      ...new Set(
        [
          ...teams.map((team) => team.leaderId),
          ...members.map((member) => member.userId),
        ].filter(Boolean) as string[],
      ),
    ];
    const users = userIds.length
      ? await this.userRepo.find({
          where: { id: In(userIds), deleted: false },
          select: { id: true, username: true, nickname: true },
        })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const membersByTeam = new Map<string, TeamMemberView[]>();
    members.forEach((member) => {
      const user = usersById.get(member.userId);
      if (!user) return;
      const views = membersByTeam.get(member.teamId) ?? [];
      views.push({
        id: member.id,
        userId: user.id,
        username: user.username,
        nickname: user.nickname,
        memberRole: member.memberRole,
      });
      membersByTeam.set(member.teamId, views);
    });
    const nodes = new Map<string, TeamTreeNode>();
    teams.forEach((team) =>
      nodes.set(team.id, {
        ...team,
        leaderName: team.leaderId
          ? usersById.get(team.leaderId)?.nickname ||
            usersById.get(team.leaderId)?.username ||
            null
          : null,
        members: membersByTeam.get(team.id) ?? [],
        children: [],
      }),
    );
    const roots: TeamTreeNode[] = [];
    nodes.forEach((node) => {
      const parent =
        node.parentId === '0' ? undefined : nodes.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    return roots;
  }

  async listUsers() {
    return this.userRepo.find({
      where: { deleted: false, status: UserStatus.Active },
      select: { id: true, username: true, nickname: true, email: true },
      order: { username: 'ASC' },
    });
  }

  async create(dto: CreateTeamDto) {
    const parentId = dto.parentId || '0';
    await this.assertParent(parentId);
    await this.assertUser(dto.leaderId);
    const team = await this.teamRepo.save(
      this.teamRepo.create({
        id: nextSnowflakeId(),
        teamName: dto.teamName.trim(),
        teamCode: this.emptyToNull(dto.teamCode),
        description: this.emptyToNull(dto.description),
        leaderId: this.emptyToNull(dto.leaderId),
        parentId,
        sort: dto.sort ?? 0,
        status: dto.status ?? 1,
      }),
    );
    if (team.leaderId) await this.setLeader(team.id, team.leaderId);
    if (team.leaderId) await this.invalidateTeamHierarchyMembers(team.id);
    return team;
  }

  async update(id: string, dto: UpdateTeamDto) {
    const team = await this.getTeam(id);
    const parentId =
      dto.parentId === undefined ? team.parentId : dto.parentId || '0';
    await this.assertParent(parentId, id);
    if (dto.leaderId !== undefined)
      await this.assertUser(dto.leaderId || undefined);
    await this.teamRepo.update(id, {
      ...(dto.teamName !== undefined ? { teamName: dto.teamName.trim() } : {}),
      ...(dto.teamCode !== undefined
        ? { teamCode: this.emptyToNull(dto.teamCode) }
        : {}),
      ...(dto.description !== undefined
        ? { description: this.emptyToNull(dto.description) }
        : {}),
      ...(dto.leaderId !== undefined
        ? { leaderId: this.emptyToNull(dto.leaderId) }
        : {}),
      ...(dto.parentId !== undefined ? { parentId } : {}),
      ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      updatedAt: new Date(),
    });
    if (dto.leaderId) await this.setLeader(id, dto.leaderId);
    if (dto.leaderId !== undefined && !dto.leaderId && team.leaderId) {
      await this.memberRepo.update(
        { teamId: id, userId: team.leaderId },
        { memberRole: 'member' },
      );
    }
    // 上级、状态或负责人变化会改变本部门及所有下级部门成员的继承角色。
    if (
      dto.parentId !== undefined ||
      dto.status !== undefined ||
      dto.leaderId !== undefined
    ) {
      await this.invalidateTeamHierarchyMembers(id);
    }
    return this.getTeam(id);
  }

  async remove(id: string) {
    await this.getTeam(id);
    const child = await this.teamRepo.exists({
      where: { parentId: id, deleted: false },
    });
    if (child) throw new BadRequestException('请先删除或迁移下级部门');
    await this.teamRepo.update(id, { deleted: true, updatedAt: new Date() });
    return { success: true };
  }

  async addMember(teamId: string, dto: AddTeamMemberDto) {
    await this.getTeam(teamId);
    await this.assertUser(dto.userId);
    if (dto.memberRole === 'leader') await this.setLeader(teamId, dto.userId);
    else
      await this.memberRepo.upsert(
        {
          id: nextSnowflakeId(),
          teamId,
          userId: dto.userId,
          memberRole: 'member',
        },
        ['teamId', 'userId'],
      );
    if (dto.memberRole === 'leader') {
      await this.invalidateTeamHierarchyMembers(teamId);
    } else {
      // 新成员立即获得该部门及上级部门的继承角色。
      await this.authorizationCache.invalidate(dto.userId);
    }
    return { success: true };
  }

  async removeMember(teamId: string, userId: string) {
    const team = await this.getTeam(teamId);
    if (team.leaderId === userId)
      throw new BadRequestException('请先指定新的负责人再移除当前负责人');
    await this.memberRepo.delete({ teamId, userId });
    await this.authorizationCache.invalidate(userId);
    return { success: true };
  }

  async listRoles(teamId: string) {
    await this.getTeam(teamId);
    const links = await this.teamRoleRepo.find({ where: { teamId } });
    return links.map((link) => link.roleId);
  }

  async replaceRoles(teamId: string, roleIds: string[]) {
    await this.getTeam(teamId);
    const uniqueIds = [...new Set(roleIds)];
    const roles = uniqueIds.length ? await this.roleRepo.find({ where: { id: In(uniqueIds), status: 1 } }) : [];
    if (roles.length !== uniqueIds.length) throw new BadRequestException('存在无效或已禁用的角色');
    await this.teamRoleRepo.manager.transaction(async (manager) => {
      await manager.delete(TeamRoleEntity, { teamId });
      if (uniqueIds.length) await manager.insert(TeamRoleEntity, uniqueIds.map((roleId) => ({ id: nextSnowflakeId(), teamId, roleId })));
    });
    // 父部门角色会被下级部门成员继承，不能只失效当前部门成员。
    await this.invalidateTeamHierarchyMembers(teamId);
    return { teamId, roleIds: uniqueIds };
  }

  private async getTeam(id: string) {
    const team = await this.teamRepo.findOne({ where: { id, deleted: false } });
    if (!team) throw new NotFoundException('部门不存在');
    return team;
  }

  private async assertUser(userId?: string) {
    if (!userId) return;
    const user = await this.userRepo.exists({
      where: { id: userId, deleted: false, status: UserStatus.Active },
    });
    if (!user) throw new BadRequestException('负责人或成员用户不存在或已禁用');
  }

  private async assertParent(parentId: string, teamId?: string) {
    if (parentId === '0') return;
    if (parentId === teamId)
      throw new BadRequestException('部门不能作为自己的上级');
    let currentId: string | undefined = parentId;
    while (currentId && currentId !== '0') {
      const parent = await this.teamRepo.findOne({
        where: { id: currentId, deleted: false },
      });
      if (!parent) throw new BadRequestException('上级部门不存在或已删除');
      if (parent.id === teamId)
        throw new BadRequestException('不能将部门移动到其下级部门');
      currentId = parent.parentId;
    }
  }

  private async setLeader(teamId: string, userId: string) {
    const team = await this.getTeam(teamId);
    if (team.leaderId && team.leaderId !== userId)
      await this.memberRepo.update(
        { teamId, userId: team.leaderId },
        { memberRole: 'member' },
      );
    await this.teamRepo.update(teamId, {
      leaderId: userId,
      updatedAt: new Date(),
    });
    await this.memberRepo.upsert(
      { id: nextSnowflakeId(), teamId, userId, memberRole: 'leader' },
      ['teamId', 'userId'],
    );
  }

  /**
   * 失效一个部门及其全部下级部门成员的授权快照。
   * 成员在鉴权时会继承自己所在部门到根部门路径上的角色，因此父级角色
   * 调整必须同步清理下级成员的 L1/L2 缓存。
   */
  private async invalidateTeamHierarchyMembers(teamId: string) {
    const teams = await this.teamRepo.find({
      where: { deleted: false },
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    teams.forEach((team) => {
      const children = childrenByParent.get(team.parentId) ?? [];
      children.push(team.id);
      childrenByParent.set(team.parentId, children);
    });

    const affectedTeamIds = new Set<string>([teamId]);
    const pending = [teamId];
    while (pending.length) {
      const currentId = pending.pop()!;
      for (const childId of childrenByParent.get(currentId) ?? []) {
        if (!affectedTeamIds.has(childId)) {
          affectedTeamIds.add(childId);
          pending.push(childId);
        }
      }
    }

    const members = await this.memberRepo.find({
      where: { teamId: In([...affectedTeamIds]) },
      select: { userId: true },
    });
    await Promise.all(
      [...new Set(members.map((member) => member.userId))].map((userId) =>
        this.authorizationCache.invalidate(userId),
      ),
    );
  }

  private emptyToNull(value?: string): string | null {
    return value?.trim() || null;
  }
}

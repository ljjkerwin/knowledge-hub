import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { UserEntity, UserStatus } from '../user/entities/user.entity';
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
    return { success: true };
  }

  async removeMember(teamId: string, userId: string) {
    const team = await this.getTeam(teamId);
    if (team.leaderId === userId)
      throw new BadRequestException('请先指定新的负责人再移除当前负责人');
    await this.memberRepo.delete({ teamId, userId });
    return { success: true };
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

  private emptyToNull(value?: string): string | null {
    return value?.trim() || null;
  }
}

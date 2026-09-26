import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { RoleCode, RoleEntity } from './entities/role.entity';
import { UserRoleEntity } from './entities/user-role.entity';

export type UserWithRoles = UserEntity & { roles: RoleCode[] };

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
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

  private async withRoles(user: UserEntity): Promise<UserWithRoles> {
    const rows = await this.roleRepo
      .createQueryBuilder('role')
      .innerJoin(
        UserRoleEntity,
        'userRole',
        'userRole.role_id = role.id AND userRole.user_id = :userId',
        { userId: user.id },
      )
      .where('role.status = :status', { status: 1 })
      .select('role.role_code', 'roleCode')
      .getRawMany<{ roleCode: RoleCode }>();

    return Object.assign(user, { roles: rows.map(({ roleCode }) => roleCode) });
  }
}

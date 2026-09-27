import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TeamEntity } from './entities/team.entity';
import { TeamMemberEntity } from './entities/team-member.entity';
import { TeamRoleEntity } from './entities/team-role.entity';
import { RoleEntity } from '../user/entities/role.entity';
import { AuthorizationCacheService } from '../user/authorization-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TeamEntity, TeamMemberEntity, TeamRoleEntity, UserEntity, RoleEntity]),
  ],
  controllers: [TeamController],
  providers: [TeamService, AuthorizationCacheService],
})
export class TeamModule {}

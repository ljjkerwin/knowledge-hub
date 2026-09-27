import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { UserService } from './user.service';
import { AuthorizationCacheService } from './authorization-cache.service';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';
import { TeamEntity } from '../team/entities/team.entity';
import { TeamMemberEntity } from '../team/entities/team-member.entity';
import { TeamRoleEntity } from '../team/entities/team-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RoleEntity,
      UserRoleEntity,
      PermissionEntity,
      RolePermissionEntity,
      TeamEntity,
      TeamMemberEntity,
      TeamRoleEntity,
    ]),
  ],
  controllers: [RbacController, UserAdminController],
  providers: [
    UserService,
    AuthorizationCacheService,
    RbacService,
    UserAdminService,
  ],
  exports: [UserService, AuthorizationCacheService],
})
export class UserModule {}

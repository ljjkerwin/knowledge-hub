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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      RoleEntity,
      UserRoleEntity,
      PermissionEntity,
      RolePermissionEntity,
    ]),
  ],
  controllers: [RbacController],
  providers: [UserService, AuthorizationCacheService, RbacService],
  exports: [UserService, AuthorizationCacheService],
})
export class UserModule {}

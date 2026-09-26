import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { UserService } from './user.service';
import { AuthorizationCacheService } from './authorization-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, RoleEntity])],
  providers: [UserService, AuthorizationCacheService],
  exports: [UserService, AuthorizationCacheService],
})
export class UserModule {}

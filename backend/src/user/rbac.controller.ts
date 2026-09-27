import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { RoleCode } from './entities/role.entity';
import { RbacService } from './rbac.service';

class ReplaceRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionIds: string[];
}

/** 管理员的权限树和角色授权接口。 */
@Controller('rbac')
@Roles(RoleCode.Admin)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('permissions')
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @Get('roles')
  listRoles() {
    return this.rbacService.listRoles();
  }

  @Put('roles/:roleId/permissions')
  replaceRolePermissions(
    @Param('roleId') roleId: string,
    @Body() dto: ReplaceRolePermissionsDto,
  ) {
    return this.rbacService.replaceRolePermissions(roleId, dto.permissionIds);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { RoleCode } from './entities/role.entity';
import { RbacService } from './rbac.service';

class ReplaceRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionIds: string[];
}

class CreateRoleDto {
  @IsString()
  @MaxLength(50)
  roleName: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^ROLE_[A-Z0-9_]+$/, {
    message: '角色编码须以 ROLE_ 开头，并仅包含大写字母、数字和下划线',
  })
  roleCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionIds: string[] = [];
}

class PermissionDto {
  @IsString()
  parentId: string;

  @IsString()
  @MaxLength(50)
  permissionName: string;

  @IsString()
  @MaxLength(100)
  permissionCode: string;

  @IsInt()
  @IsIn([1, 2, 3])
  permissionType: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  menuUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsInt()
  sort: number;

  @IsInt()
  @IsIn([0, 1])
  status: number;
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

  @Post('permissions')
  createPermission(@Body() dto: PermissionDto) {
    return this.rbacService.createPermission(dto);
  }

  @Put('permissions/:permissionId')
  updatePermission(
    @Param('permissionId') permissionId: string,
    @Body() dto: PermissionDto,
  ) {
    return this.rbacService.updatePermission(permissionId, dto);
  }

  @Delete('permissions/:permissionId')
  deletePermission(@Param('permissionId') permissionId: string) {
    return this.rbacService.deletePermission(permissionId);
  }

  @Get('roles')
  listRoles() {
    return this.rbacService.listRoles();
  }

  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Put('roles/:roleId/permissions')
  replaceRolePermissions(
    @Param('roleId') roleId: string,
    @Body() dto: ReplaceRolePermissionsDto,
  ) {
    return this.rbacService.replaceRolePermissions(roleId, dto.permissionIds);
  }
}

import { SetMetadata } from '@nestjs/common';
import { RoleCode } from '../user/entities/role.entity';

export const ROLES_KEY = 'roles';
/** 声明访问路由所需的任一角色。 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);

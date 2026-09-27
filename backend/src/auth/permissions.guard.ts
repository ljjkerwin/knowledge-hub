import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

/** 基于 permission_code 的运行时接口授权守卫。 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { roles?: string[]; permissions?: string[] };
    }>();
    // 平台管理员是超级管理员，不依赖角色-权限关联逐项维护权限。
    if (request.user?.roles?.includes('ROLE_ADMIN')) return true;
    if (request.user?.permissions?.some((code) => required.includes(code))) {
      return true;
    }
    throw new ForbiddenException('你没有执行此操作的权限');
  }
}

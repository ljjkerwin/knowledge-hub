import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/about'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径不需要认证
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // 静态资源和 API 路由跳过
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Access token 只存在浏览器内存，refresh token 是后端域名下的 HttpOnly Cookie，
  // 因此前端 Proxy 无法且不应读取认证凭证。受保护页面在客户端刷新会话后校验。
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

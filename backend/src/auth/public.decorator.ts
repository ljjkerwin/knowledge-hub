import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记无需 JWT 认证的控制器或接口。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

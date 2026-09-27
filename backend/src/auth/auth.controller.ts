import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  Response,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { LoginCryptoService } from './login-crypto.service';
import { Public } from './public.decorator';

class LoginDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(1)
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly loginCryptoService: LoginCryptoService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @Public()
  async login(@Body() dto: LoginDto, @Response({ passthrough: true }) response: ExpressResponse) {
    const result = await this.authService.login(
      dto.username,
      this.loginCryptoService.decrypt(dto.password),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post('refresh')
  @Public()
  async refresh(
    @Request() request: ExpressRequest,
    @Response({ passthrough: true }) response: ExpressResponse,
  ) {
    const result = await this.authService.refresh(this.readRefreshCookie(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post('logout')
  @Public()
  async logout(
    @Request() request: ExpressRequest,
    @Response({ passthrough: true }) response: ExpressResponse,
  ) {
    try {
      await this.authService.logout(this.readRefreshCookie(request));
    } finally {
      // 即使 Redis 暂时不可用，也不应继续让浏览器携带旧会话 cookie。
      response.clearCookie(this.refreshCookieName(), { path: '/api/auth' });
    }
    return { success: true };
  }

  @Get('profile')
  async getProfile(@Request() req: { user: { id: string } }) {
    const user = await this.userService.findById(req.user.id);
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  private setRefreshCookie(response: ExpressResponse, token: string) {
    response.cookie(this.refreshCookieName(), token, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.authService.getRefreshTokenTtlSeconds() * 1000,
    });
  }

  private readRefreshCookie(request: ExpressRequest): string {
    const name = this.refreshCookieName();
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!cookie) return '';
    try {
      return decodeURIComponent(cookie.slice(name.length + 1));
    } catch {
      return '';
    }
  }

  private refreshCookieName() {
    return this.config.get<string>('REFRESH_TOKEN_COOKIE_NAME', 'kh_refresh_token');
  }
}

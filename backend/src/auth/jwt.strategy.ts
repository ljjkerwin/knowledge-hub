import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';

export interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'knowledge-hub-jwt-secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userService.findAuthorizationById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    // 通过 L1 → Redis → PostgreSQL 取得最新授权快照。
    return { id: user.id, username: user.username, roles: user.roles };
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const isBcryptHash = user.passwordHash.startsWith('$2');
    const isValid = isBcryptHash
      ? await compare(password, user.passwordHash)
      : this.matchesLegacySha256(password, user.passwordHash);

    if (!isValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // Migrate legacy SHA-256 entries transparently after a successful login.
    if (!isBcryptHash) {
      const passwordHash = await hash(password, 10);
      await this.userService.updatePasswordHash(user.id, passwordHash);
      user.passwordHash = passwordHash;
    }

    return user;
  }

  private matchesLegacySha256(password: string, storedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;

    const candidateHash = createHash('sha256').update(password).digest('hex');
    return timingSafeEqual(Buffer.from(candidateHash), Buffer.from(storedHash));
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);

    const payload = { sub: user.id, username: user.username };
    const token = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
      },
      token,
    };
  }
}

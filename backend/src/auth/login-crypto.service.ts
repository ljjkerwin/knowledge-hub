import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  constants,
  createPrivateKey,
  KeyObject,
  privateDecrypt,
} from 'node:crypto';

@Injectable()
export class LoginCryptoService {
  private readonly privateKey: KeyObject;

  constructor(config: ConfigService) {
    const encodedPrivateKey = config.get<string>('LOGIN_RSA_PRIVATE_KEY_BASE64');
    if (!encodedPrivateKey) {
      throw new InternalServerErrorException(
        'LOGIN_RSA_PRIVATE_KEY_BASE64 is not configured',
      );
    }

    try {
      this.privateKey = createPrivateKey({
        key: Buffer.from(encodedPrivateKey, 'base64'),
        format: 'pem',
      });
    } catch {
      throw new InternalServerErrorException('LOGIN_RSA_PRIVATE_KEY_BASE64 is invalid');
    }
  }

  decrypt(encryptedPassword: string): string {
    try {
      return privateDecrypt(
        {
          key: this.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(encryptedPassword, 'base64'),
      ).toString('utf8');
    } catch {
      throw new UnauthorizedException('用户名或密码错误');
    }
  }
}

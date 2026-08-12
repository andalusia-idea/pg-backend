import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { ApiError } from '../../shared/exception';
import { AuthService } from '../auth.service';
import { AuthInfoDto } from '../dto/auth-info.dto';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string): Promise<AuthInfoDto> {
    const authInfo = await this.authService.validateUser({ email, password });

    // Legacy constructed an UnauthorizedException here but never threw it,
    // so bad credentials fell through as a null user.
    if (!authInfo) throw ApiError.unauthorized('Invalid email or password');

    return authInfo;
  }
}

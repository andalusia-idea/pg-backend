import { JwtConfig } from '@app/configuration';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthInfoDto } from '../dto/auth-info.dto';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(jwtConfig: JwtConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.ACCESS_TOKEN_SECRET,
    });
  }

  /** Whatever this returns becomes `request.user`. */
  validate(payload: AuthInfoDto): AuthInfoDto {
    return new AuthInfoDto(payload);
  }
}

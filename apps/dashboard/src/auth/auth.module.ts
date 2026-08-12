import { JwtConfig } from '@app/configuration';
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategy/jwt.strategy';
import { LocalStrategy } from './strategy/local.strategy';

/**
 * Global because JwtAuthGuard / RolesGuard are registered app-wide and every
 * feature module relies on the principal this module puts on the request.
 */
@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [JwtConfig],
      useFactory: (jwtConfig: JwtConfig) => ({
        secret: jwtConfig.ACCESS_TOKEN_SECRET,
        signOptions: { expiresIn: jwtConfig.ACCESS_TOKEN_EXPIRE },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService],
})
export class AuthModule {}

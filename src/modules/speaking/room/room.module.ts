import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../../auth/auth.module';
import { RoomController } from './room.controller';
import { RoomGateway } from './room.gateway';
import { RoomService } from './room.service';
import { TurnCredentialsService } from './turn-credentials.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    AuthModule, // provides TokenService for JwtAuthGuard on the ice-servers route
  ],
  controllers: [RoomController],
  providers: [RoomService, RoomGateway, TurnCredentialsService],
  exports: [RoomService],
})
export class RoomModule {}

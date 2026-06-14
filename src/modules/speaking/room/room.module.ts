import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}

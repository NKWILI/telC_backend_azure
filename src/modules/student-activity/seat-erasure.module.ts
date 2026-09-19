import { Module } from '@nestjs/common';
import { SeatErasureService } from './seat-erasure';

@Module({
  providers: [SeatErasureService],
  exports: [SeatErasureService],
})
export class SeatErasureModule {}

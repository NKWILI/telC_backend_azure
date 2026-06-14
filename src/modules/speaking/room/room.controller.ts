import { Controller, Get, Post, Param, Logger, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoomService } from './room.service';
import { CreateRoomResponseDto } from './dto/create-room-response.dto';
import { RoomInfoResponseDto } from './dto/room-info-response.dto';

@ApiTags('Speaking Rooms')
@Controller('api/speaking/rooms')
export class RoomController {
  private readonly logger = new Logger(RoomController.name);

  constructor(private readonly roomService: RoomService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new speaking practice room' })
  createRoom(): CreateRoomResponseDto {
    const result = this.roomService.createRoom();
    this.logger.log(`POST /api/speaking/rooms → roomId=${result.roomId}`);
    return result;
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Get room info by roomId (public — no auth required)' })
  getRoom(@Param('roomId') roomId: string): RoomInfoResponseDto {
    const room = this.roomService.getRoom(roomId);

    if (!room || room.status === 'ended') {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    this.logger.log(`GET /api/speaking/rooms/${roomId} → status=${room.status}`);

    return {
      roomId: room.roomId,
      status: room.status as 'waiting' | 'active',
      hasHost: room.hostSocketId !== null,
      hasGuest: room.guest !== null,
      expiresAt: room.expiresAt.toISOString(),
    };
  }
}

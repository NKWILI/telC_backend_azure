import { Controller, Get, Post, Param, Request, Logger, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { AccessTokenPayload } from '../../../shared/interfaces/token-payload.interface';
import { RoomService } from './room.service';
import { TurnCredentialsService } from './turn-credentials.service';
import { CreateRoomResponseDto } from './dto/create-room-response.dto';
import { RoomInfoResponseDto } from './dto/room-info-response.dto';
import { IceServersResponseDto } from './dto/ice-servers-response.dto';

@ApiTags('Speaking Rooms')
@Controller('api/speaking/rooms')
export class RoomController {
  private readonly logger = new Logger(RoomController.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly turnCredentialsService: TurnCredentialsService,
  ) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Create a new speaking practice room' })
  createRoom(): CreateRoomResponseDto {
    const result = this.roomService.createRoom();
    this.logger.log(`POST /api/speaking/rooms → roomId=${result.roomId}`);
    return result;
  }

  // NOTE: must be declared BEFORE the ':roomId' route, otherwise "ice-servers"
  // is captured as a roomId param.
  @Get('ice-servers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get STUN/TURN ICE servers with ephemeral TURN credentials' })
  getIceServers(@Request() req: { student: AccessTokenPayload }): IceServersResponseDto {
    const studentId = req.student?.studentId ?? 'anonymous';
    return this.turnCredentialsService.getIceServers(studentId);
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

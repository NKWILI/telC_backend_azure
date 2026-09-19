import {
  Controller,
  Get,
  Post,
  Param,
  Request,
  Logger,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../../../shared/guards/student-subscription.guard';
import { AccessTokenPayload } from '../../../shared/interfaces/token-payload.interface';
import { RateLimitService } from '../../../shared/services/rate-limit.service';
import { RoomService } from './room.service';
import type { Room } from './interfaces/room.interface';
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
    private readonly rateLimit: RateLimitService,
  ) {}

  // Creating a room is where a student spends their entitlement, so this is
  // where it is checked. The WebSocket deliberately stays open: the guest
  // joins by link and may have no Lerniqo account, so authenticating the
  // socket would break the feature rather than secure it. A room dies after
  // two hours and cannot be extended, which bounds what an already-open room
  // can be used for.
  @Post()
  @UseGuards(ThrottlerGuard, JwtAuthGuard, StudentSubscriptionGuard)
  @ApiBearerAuth()
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
  @ApiOperation({
    summary: 'Get STUN/TURN ICE servers with ephemeral TURN credentials',
  })
  getIceServers(
    @Request() req: { student: AccessTokenPayload },
  ): IceServersResponseDto {
    const studentId = req.student?.studentId ?? 'anonymous';
    return this.turnCredentialsService.getIceServers(studentId);
  }

  /**
   * Joining by short code (D32): resolves the code, then the client runs the
   * usual `GET /rooms/{id}` and `join-room`. Login required, so guessing can
   * be counted per student; joining by link stays open for guests.
   */
  @Get('code/:code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Find a live room by its 6-character short code',
    description:
      'Case-insensitive, trimmed. 404 when no live room has this code. 20 lookups per 10 minutes per student.',
  })
  async getRoomByCode(
    @Request() req: { student: AccessTokenPayload },
    @Param('code') code: string,
  ): Promise<RoomInfoResponseDto> {
    await this.rateLimit.checkRoomCodeLookupLimit(req.student.studentId);
    const room = this.roomService.getRoomByCode(code);
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return this.toInfo(room);
  }

  @Get(':roomId')
  @ApiOperation({
    summary: 'Get room info by roomId (public — no auth required)',
  })
  getRoom(@Param('roomId') roomId: string): RoomInfoResponseDto {
    const room = this.roomService.getRoom(roomId);

    if (!room || room.status === 'ended') {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    this.logger.log(
      `GET /api/speaking/rooms/${roomId} → status=${room.status}`,
    );

    return this.toInfo(room);
  }

  /** Both callers have already answered 404 for an ended room. */
  private toInfo(room: Room): RoomInfoResponseDto {
    return {
      roomId: room.roomId,
      status: room.status as RoomInfoResponseDto['status'],
      hasHost: room.hostSocketId !== null,
      hasGuest: room.guest !== null,
      expiresAt: room.expiresAt.toISOString(),
    };
  }
}

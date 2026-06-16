import { ApiProperty } from '@nestjs/swagger';

export class IceServerDto {
  @ApiProperty({ example: 'turn:64.226.72.102:3478?transport=udp' })
  urls: string;

  @ApiProperty({ required: false, description: 'Ephemeral username (TURN only)' })
  username?: string;

  @ApiProperty({ required: false, description: 'Ephemeral credential (TURN only)' })
  credential?: string;

  @ApiProperty({ required: false, example: 'password' })
  credentialType?: string;
}

export class IceServersResponseDto {
  @ApiProperty({ type: [IceServerDto] })
  iceServers: IceServerDto[];

  @ApiProperty({ example: 3600, description: 'Seconds until the TURN credentials expire' })
  ttlSeconds: number;
}

import { ApiProperty } from '@nestjs/swagger';

export class CenterErrorResponseDto {
  @ApiProperty({ example: 'INVALID_CREDENTIALS' })
  error: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'INVALID_CREDENTIALS' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['email must be an email'],
      },
    ],
  })
  message: string | string[];
}

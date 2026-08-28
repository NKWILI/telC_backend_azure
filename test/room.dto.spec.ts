import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { JoinRoomDto } from '../src/modules/speaking/room/dto/join-room.dto';
import { CreateRoomResponseDto } from '../src/modules/speaking/room/dto/create-room-response.dto';
import { RoomInfoResponseDto } from '../src/modules/speaking/room/dto/room-info-response.dto';
import { CreateRoomQueryDto } from '../src/modules/speaking/room/dto/create-room-query.dto';
import { TopicDto } from '../src/modules/speaking/room/dto/topic.dto';
import { SPEAKING_TOPICS } from '../src/modules/speaking/room/speaking-topics.data';
import { ShuffleTopicDto } from '../src/modules/speaking/room/dto/shuffle-topic.dto';

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('JoinRoomDto', () => {
  async function validateDto(plain: object) {
    const dto = plainToInstance(JoinRoomDto, plain);
    return validate(dto);
  }

  it('accepts a valid host payload', async () => {
    const errors = await validateDto({
      roomId: VALID_UUID,
      displayName: 'Anna',
      hostToken: 'some-token',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid guest payload (no hostToken)', async () => {
    const errors = await validateDto({
      roomId: VALID_UUID,
      displayName: 'Max',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-UUID roomId', async () => {
    const errors = await validateDto({
      roomId: 'not-a-uuid',
      displayName: 'Anna',
    });
    expect(errors.some((e) => e.property === 'roomId')).toBe(true);
  });

  it('rejects an empty displayName', async () => {
    const errors = await validateDto({
      roomId: VALID_UUID,
      displayName: '',
    });
    expect(errors.some((e) => e.property === 'displayName')).toBe(true);
  });

  it('rejects a displayName longer than 100 characters', async () => {
    const errors = await validateDto({
      roomId: VALID_UUID,
      displayName: 'x'.repeat(101),
    });
    expect(errors.some((e) => e.property === 'displayName')).toBe(true);
  });

  it('rejects a missing roomId', async () => {
    const errors = await validateDto({ displayName: 'Anna' });
    expect(errors.some((e) => e.property === 'roomId')).toBe(true);
  });
});

describe('CreateRoomResponseDto', () => {
  it('can be constructed with required fields', () => {
    const dto = new CreateRoomResponseDto();
    dto.roomId = VALID_UUID;
    dto.hostToken = 'secret-token';
    dto.expiresAt = new Date().toISOString();
    dto.topic = Object.assign(new TopicDto(), SPEAKING_TOPICS[0]);
    expect(dto.roomId).toBe(VALID_UUID);
    expect(dto.hostToken).toBe('secret-token');
    expect(typeof dto.expiresAt).toBe('string');
    expect(dto.topic.id).toBe('b1-t2-001');
  });
});

describe('RoomInfoResponseDto', () => {
  it('can be constructed with all fields', () => {
    const dto = new RoomInfoResponseDto();
    dto.roomId = VALID_UUID;
    dto.status = 'waiting';
    dto.hasHost = false;
    dto.hasGuest = false;
    dto.expiresAt = new Date().toISOString();
    dto.topic = Object.assign(new TopicDto(), SPEAKING_TOPICS[0]);
    expect(dto.status).toBe('waiting');
    expect(dto.hasHost).toBe(false);
    expect(dto.hasGuest).toBe(false);
    expect(dto.topic).toEqual(SPEAKING_TOPICS[0]);
  });
});

describe('CreateRoomQueryDto', () => {
  it('accepts level B1', async () => {
    const dto = plainToInstance(CreateRoomQueryDto, { level: 'B1' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([{}, { level: 'A2' }, { level: 'B2' }])(
    'rejects unsupported input %p',
    async (input) => {
      const dto = plainToInstance(CreateRoomQueryDto, input);

      expect(
        (await validate(dto)).some((error) => error.property === 'level'),
      ).toBe(true);
    },
  );
});

describe('ShuffleTopicDto', () => {
  it('accepts a UUID roomId', async () => {
    const dto = plainToInstance(ShuffleTopicDto, { roomId: VALID_UUID });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([{}, { roomId: '' }, { roomId: 'not-a-uuid' }])('rejects invalid input %p', async (input) => {
    const dto = plainToInstance(ShuffleTopicDto, input);

    expect((await validate(dto)).some((error) => error.property === 'roomId')).toBe(true);
  });
});

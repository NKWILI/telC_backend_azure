import 'reflect-metadata';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RoomController } from '../src/modules/speaking/room/room.controller';

const GUARDS_METADATA = '__guards__';

describe('RoomController — throttle guard wiring', () => {
  it('createRoom() (POST) has ThrottlerGuard applied', () => {
    const guards: Function[] =
      Reflect.getMetadata(GUARDS_METADATA, RoomController.prototype.createRoom) ?? [];
    expect(guards).toContain(ThrottlerGuard);
  });

  it('getRoom() (GET) does NOT have ThrottlerGuard applied', () => {
    const guards: Function[] =
      Reflect.getMetadata(GUARDS_METADATA, RoomController.prototype.getRoom) ?? [];
    expect(guards).not.toContain(ThrottlerGuard);
  });
});

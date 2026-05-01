import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prismaMock: any;
  let txMock: any;

  beforeEach(() => {
    txMock = {
      deviceSession: {
        findFirst: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
    };

    prismaMock = {
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(txMock),
      ),
      deviceSession: {
        findFirst: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
    };

    service = new AuthService(prismaMock, {} as any);
  });

  describe('upsertDeviceSession', () => {
    it('creates a device session when active count is less than 3', async () => {
      const session = { id: 'session-1' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(2);
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-1',
        'refresh-hash-1',
        'Pixel',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(txMock.deviceSession.findFirst).toHaveBeenCalledWith({
        where: { student_id: 'student-1', device_id: 'device-1', revoked_at: null },
        select: { id: true },
      });
      expect(txMock.deviceSession.count).toHaveBeenCalledWith({
        where: { student_id: 'student-1', revoked_at: null },
      });
      expect(txMock.deviceSession.deleteMany).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledWith({
        where: { device_id: 'device-1' },
        update: {
          student_id: 'student-1',
          refresh_token_hash: 'refresh-hash-1',
          device_name: 'Pixel',
          revoked_at: null,
          last_used_at: expect.any(Date),
        },
        create: {
          student_id: 'student-1',
          device_id: 'device-1',
          refresh_token_hash: 'refresh-hash-1',
          device_name: 'Pixel',
        },
      });
      expect(result).toEqual(session);
    });

    it('evicts the oldest active session when active count is 3', async () => {
      const session = { id: 'session-2' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(3);
      txMock.deviceSession.findFirst.mockResolvedValueOnce({ id: 'oldest-session' });
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-2',
        'refresh-hash-2',
      );

      expect(txMock.deviceSession.findFirst).toHaveBeenNthCalledWith(2, {
        where: { student_id: 'student-1', revoked_at: null },
        orderBy: { created_at: 'asc' },
        select: { id: true },
      });
      expect(txMock.deviceSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['oldest-session'] } },
      });
      expect(txMock.deviceSession.upsert).toHaveBeenCalled();
      expect(result).toEqual(session);
    });

    it('reuses an existing device_id without evicting the oldest session', async () => {
      const session = { id: 'session-3' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce({ id: 'existing-session' });
      txMock.deviceSession.count.mockResolvedValueOnce(3);
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-1',
        'refresh-hash-3',
      );

      expect(txMock.deviceSession.findFirst).toHaveBeenCalledTimes(1);
      expect(txMock.deviceSession.deleteMany).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { device_id: 'device-1' } }),
      );
      expect(result).toEqual(session);
    });

    it('executes session operations inside a transaction', async () => {
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-4' });

      await service.upsertDeviceSession(
        'student-2',
        'device-4',
        'refresh-hash-4',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.deviceSession.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.deviceSession.count).not.toHaveBeenCalled();
      expect(prismaMock.deviceSession.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.deviceSession.upsert).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledTimes(1);
    });
  });
});

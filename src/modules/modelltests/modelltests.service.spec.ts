import { NotFoundException } from '@nestjs/common';
import { ModelltestsService } from './modelltests.service';

const mockPrisma = {
  modelltest: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

const MT1_ROW = {
  id: 'mt1-uuid',
  number: 1,
  title: 'Modelltest 1',
  created_at: new Date(),
  sprachbausteineExercises: [{ id: 'sb1-uuid' }],
  sprachbausteineTeil2Exercises: [{ id: 'sb2-uuid' }],
  lesenTeil1Exercises: [{ id: 'l1-uuid' }],
  lesenTeil2Exercises: [{ id: 'l2-uuid' }],
  lesenTeil3Exercises: [{ id: 'l3-uuid' }],
};

describe('ModelltestsService', () => {
  let service: ModelltestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModelltestsService(mockPrisma as any);
  });

  describe('getAll', () => {
    it('returns mapped list when DB has rows', async () => {
      mockPrisma.modelltest.findMany.mockResolvedValue([
        { id: 'mt1-uuid', number: 1, title: 'Modelltest 1', created_at: new Date() },
        { id: 'mt2-uuid', number: 2, title: 'Modelltest 2', created_at: new Date() },
      ]);

      const result = await service.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'mt1-uuid', number: 1, title: 'Modelltest 1' });
      expect(result[1]).toEqual({ id: 'mt2-uuid', number: 2, title: 'Modelltest 2' });
      expect(mockPrisma.modelltest.findMany).toHaveBeenCalledWith({
        orderBy: { number: 'asc' },
      });
    });

    it('returns empty array when DB has no rows', async () => {
      mockPrisma.modelltest.findMany.mockResolvedValue([]);

      const result = await service.getAll();

      expect(result).toEqual([]);
    });
  });

  describe('getByNumber', () => {
    it('returns detail DTO with grouped exercise IDs when found', async () => {
      mockPrisma.modelltest.findUnique.mockResolvedValue(MT1_ROW);

      const result = await service.getByNumber(1);

      expect(result.id).toBe('mt1-uuid');
      expect(result.number).toBe(1);
      expect(result.title).toBe('Modelltest 1');
      expect(result.exercises).toEqual({
        sprachbausteineT1: ['sb1-uuid'],
        sprachbausteineT2: ['sb2-uuid'],
        lesenT1: ['l1-uuid'],
        lesenT2: ['l2-uuid'],
        lesenT3: ['l3-uuid'],
      });
      expect(mockPrisma.modelltest.findUnique).toHaveBeenCalledWith({
        where: { number: 1 },
        include: {
          sprachbausteineExercises: { select: { id: true } },
          sprachbausteineTeil2Exercises: { select: { id: true } },
          lesenTeil1Exercises: { select: { id: true } },
          lesenTeil2Exercises: { select: { id: true } },
          lesenTeil3Exercises: { select: { id: true } },
        },
      });
    });

    it('throws NotFoundException when number does not exist', async () => {
      mockPrisma.modelltest.findUnique.mockResolvedValue(null);

      await expect(service.getByNumber(99)).rejects.toThrow(NotFoundException);
    });
  });
});

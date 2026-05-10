import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type {
  ModelltestDetailDto,
  ModelltestListItemDto,
} from './dto/modelltest.dto';

@Injectable()
export class ModelltestsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<ModelltestListItemDto[]> {
    const rows = await this.prisma.modelltest.findMany({
      orderBy: { number: 'asc' },
    });
    return rows.map(({ id, number, title }) => ({ id, number, title }));
  }

  async getByNumber(number: number): Promise<ModelltestDetailDto> {
    const row = await this.prisma.modelltest.findUnique({
      where: { number },
      include: {
        sprachbausteineExercises: { select: { id: true } },
        sprachbausteineTeil2Exercises: { select: { id: true } },
        lesenTeil1Exercises: { select: { id: true } },
        lesenTeil2Exercises: { select: { id: true } },
        lesenTeil3Exercises: { select: { id: true } },
      },
    });

    if (!row) {
      throw new NotFoundException('Modelltest not found');
    }

    return {
      id: row.id,
      number: row.number,
      title: row.title,
      exercises: {
        sprachbausteineT1: row.sprachbausteineExercises.map((e) => e.id),
        sprachbausteineT2: row.sprachbausteineTeil2Exercises.map((e) => e.id),
        lesenT1: row.lesenTeil1Exercises.map((e) => e.id),
        lesenT2: row.lesenTeil2Exercises.map((e) => e.id),
        lesenT3: row.lesenTeil3Exercises.map((e) => e.id),
      },
    };
  }
}

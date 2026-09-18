import { Prisma } from '@prisma/client';
import { isUniqueViolationOn } from '../src/shared/prisma-errors';

/**
 * The shape here is copied from a real P2002 raised by the test database,
 * not written from memory. Mocks written from memory used `meta.target`,
 * which the driver adapter never sets — and every check built on them passed
 * its tests while never matching in production.
 */
const realViolation = (column: string, index: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: {
      modelName: 'ActivationCode',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${index}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { fields: [column] },
        },
      },
    },
  });

describe('isUniqueViolationOn', () => {
  it('recognises the column in the shape the driver adapter really sends', () => {
    const error = realViolation(
      'student_id',
      'activation_codes_one_connected_per_student',
    );

    expect(isUniqueViolationOn(error, 'student_id')).toBe(true);
  });

  it('recognises the index name as well', () => {
    const error = realViolation('code', 'activation_codes_code_key');

    expect(isUniqueViolationOn(error, 'activation_codes_code_key')).toBe(true);
  });

  it('does not confuse one column with another', () => {
    const error = realViolation('code', 'activation_codes_code_key');

    expect(isUniqueViolationOn(error, 'student_id')).toBe(false);
  });

  it('does not match a column name that is only part of another', () => {
    const error = realViolation('code_id', 'events_code_id_key');

    expect(isUniqueViolationOn(error, 'code')).toBe(false);
  });

  it('still matches the older `target` shape', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['code'] },
    });

    expect(isUniqueViolationOn(error, 'code')).toBe(true);
  });

  it('ignores anything that is not a unique violation', () => {
    expect(isUniqueViolationOn(new Error('boom'), 'code')).toBe(false);
    expect(
      isUniqueViolationOn(
        new Prisma.PrismaClientKnownRequestError('not found', {
          code: 'P2025',
          clientVersion: 'test',
          meta: { target: ['code'] },
        }),
        'code',
      ),
    ).toBe(false);
  });
});

import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { submitOnce } from './submit-once';

const duplicateKey = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: {
      driverAdapterError: {
        cause: { constraint: { fields: ['attempt_id'] } },
      },
    },
  });

describe('submitOnce', () => {
  const ID = '6f1c1f5e-2b1a-4b8e-9a51-0c0de0c0de00';
  let find: jest.Mock;
  let write: jest.Mock;

  beforeEach(() => {
    find = jest.fn().mockResolvedValue(null);
    write = jest.fn().mockResolvedValue(undefined);
  });

  it('stores an attempt the app did not name under a new id', async () => {
    const result = await submitOnce('s-1', undefined, find, write);

    expect(result.earlier).toBeNull();
    expect(write).toHaveBeenCalledWith(result.attemptId);
    expect(find).not.toHaveBeenCalled();
  });

  it('stores a named attempt under the id the app chose', async () => {
    const result = await submitOnce('s-1', ID, find, write);

    expect(write).toHaveBeenCalledWith(ID);
    expect(result).toEqual({ attemptId: ID, earlier: null });
  });

  it('answers a repeat from the first copy and stores nothing', async () => {
    const first = { student_id: 's-1', score: 80 };
    find.mockResolvedValue(first);

    const result = await submitOnce('s-1', ID, find, write);

    expect(result.earlier).toBe(first);
    expect(write).not.toHaveBeenCalled();
  });

  it('answers the loser of a race between two copies from the winner', async () => {
    const first = { student_id: 's-1', score: 80 };
    find.mockResolvedValueOnce(null).mockResolvedValueOnce(first);
    write.mockRejectedValue(duplicateKey());

    const result = await submitOnce('s-1', ID, find, write);

    expect(result.earlier).toBe(first);
  });

  it("refuses an id that is another student's attempt", async () => {
    find.mockResolvedValue({ student_id: 's-2' });

    await expect(submitOnce('s-1', ID, find, write)).rejects.toThrow(
      new ConflictException('ATTEMPT_ID_TAKEN'),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('lets any other failure through', async () => {
    write.mockRejectedValue(new Error('down'));

    await expect(submitOnce('s-1', ID, find, write)).rejects.toThrow('down');
  });
});

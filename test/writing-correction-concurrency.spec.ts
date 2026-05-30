import pLimit from 'p-limit';

/**
 * Independent check that p-limit actually bounds concurrency at the configured
 * cap. Mirrors what WritingModule does — wraps a slow worker and proves that
 * no matter how many submissions arrive at once, at most N run in parallel.
 */
describe('correction worker concurrency (p-limit)', () => {
  const buildQueue = (concurrency: number, worker: () => Promise<void>) => {
    const limit = pLimit(concurrency);
    return {
      add: (): Promise<void> => {
        return new Promise<void>((resolve) => {
          setImmediate(() => {
            void limit(worker).then(() => resolve());
          });
        });
      },
    };
  };

  it('caps concurrent runCorrection invocations at the configured limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const slowWorker = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
    };

    const queue = buildQueue(5, slowWorker);

    const fired: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      fired.push(queue.add());
    }
    await Promise.all(fired);

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(0);
    expect(inFlight).toBe(0);
  });

  it('would NOT cap if limit is very high (sanity check the test catches the bug)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const slowWorker = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
    };

    const queue = buildQueue(100, slowWorker);

    const fired: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      fired.push(queue.add());
    }
    await Promise.all(fired);

    // With a generous cap, all 20 should be in flight simultaneously
    expect(maxInFlight).toBeGreaterThan(5);
  });
});

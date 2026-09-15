import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Held so shutdown can actually close it. `$disconnect()` releases Prisma's
   * side of a driver adapter but does not end the pg pool underneath, so a
   * pool that is only a local in the constructor keeps its sockets open until
   * the process itself dies — which on a connection-limited host means a
   * rolling deploy holds two deployments' worth of connections at once.
   */
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    super({
      adapter,
      // How long an interactive transaction may wait to get a connection
      // before failing. Prisma's default is 2 seconds, which a slow TLS
      // handshake to Neon occasionally exceeds: the request then fails with
      // "Unable to start a transaction in the given time" although nothing is
      // wrong with it. It surfaced as an intermittent integration failure,
      // hitting a different transaction each run. Five seconds absorbs a slow
      // handshake while still failing fast on a pool that is truly exhausted.
      // Transactions that must wait longer — activation, which queues behind
      // row locks — pass their own options.
      transactionOptions: { maxWait: 5_000 },
    } as any);
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}

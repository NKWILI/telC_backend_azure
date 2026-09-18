import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';

/**
 * Reference data only: no service, no database, nothing to inject.
 *
 * It is its own module rather than a route on the centers module because the
 * Flutter app and the marketing site may read the same list, and neither
 * should have to reach into center territory for it.
 */
@Module({
  controllers: [LocationsController],
})
export class LocationsModule {}

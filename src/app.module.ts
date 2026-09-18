import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './shared/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { SpeakingModule } from './modules/speaking/speaking.module';
import { WritingModule } from './modules/writing/writing.module';
import { ListeningModule } from './modules/listening/listening.module';
import { ProgressModule } from './modules/progress/progress.module';
import { SprachbausteineModule } from './modules/sprachbausteine/sprachbausteine.module';
import { LesenModule } from './modules/lesen/lesen.module';
import { ModelltestsModule } from './modules/modelltests/modelltests.module';
import { NewsletterModule } from './modules/newsletter/newsletter.module';
import { RateLimitModule } from './shared/rate-limit.module';
import { CentersModule } from './modules/centers/centers.module';
import { LocationsModule } from './modules/locations/locations.module';
import { PlansModule } from './modules/plans/plans.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RateLimitModule,
    AuthModule,
    CentersModule,
    SpeakingModule,
    WritingModule,
    ListeningModule,
    ProgressModule,
    ModelltestsModule,
    SprachbausteineModule,
    LesenModule,
    NewsletterModule,
    LocationsModule,
    PlansModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

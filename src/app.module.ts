import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseService } from './shared/services/database.service';
import { AuthModule } from './modules/auth/auth.module';
import { SpeakingModule } from './modules/speaking/speaking.module';
import { WritingModule } from './modules/writing/writing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    SpeakingModule,
    WritingModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService],
})
export class AppModule {}

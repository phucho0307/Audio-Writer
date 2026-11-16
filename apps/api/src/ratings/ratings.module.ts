import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

/** Readers' stars for stories. */
@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsService],
})
export class RatingsModule {}

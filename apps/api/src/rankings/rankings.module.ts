import { Module } from '@nestjs/common';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

/** "Hay nhất" and "Đang hot", overall and by genre. */
@Module({
  controllers: [RankingsController],
  providers: [RankingsService],
})
export class RankingsModule {}

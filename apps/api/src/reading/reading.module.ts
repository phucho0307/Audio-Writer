import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FollowsService } from './follows.service';
import { ProgressService } from './progress.service';
import { ReadingController } from './reading.controller';

/** What a reader carries between visits: where they stopped, and what they follow. */
@Module({
  imports: [AuthModule],
  controllers: [ReadingController],
  providers: [ProgressService, FollowsService],
})
export class ReadingModule {}

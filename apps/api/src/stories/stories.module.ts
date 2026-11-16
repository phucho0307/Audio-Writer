import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { PaywallService } from './paywall.service';
import { StoryCoversController } from './story-covers.controller';
import { StoryCoversService } from './story-covers.service';

@Module({
  controllers: [StoriesController, StoryCoversController],
  providers: [StoriesService, PaywallService, StoryCoversService],
  exports: [StoriesService, PaywallService],
})
export class StoriesModule {}

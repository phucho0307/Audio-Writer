import { Module } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { PaywallService } from './paywall.service';

@Module({
  controllers: [StoriesController],
  providers: [StoriesService, PaywallService],
  exports: [StoriesService, PaywallService],
})
export class StoriesModule {}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUserService } from '../auth/current-user.service';
import { requiresVerifiedEmail } from '../auth/verified';
import { RelatedService } from './related.service';
import { SEARCH_TIER } from '../throttler/tiers';
import { DiscoveryService } from './discovery.service';
import { StoryCardsService } from './story-cards.service';

class DiscoverDto {
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  q!: string;

  /** The previous request, when this one refines it ("kết có hậu hơn"). */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  previous?: string;
}

@Controller()
export class DiscoveryController {
  private readonly needVerified: boolean;

  constructor(
    config: ConfigService,
    private readonly discovery: DiscoveryService,
    private readonly cards: StoryCardsService,
    private readonly related: RelatedService,
    private readonly currentUser: CurrentUserService,
  ) {
    this.needVerified = requiresVerifiedEmail(config);
  }

  /**
   * Find stories from a description in the reader's own words. Open to
   * readers who are not signed in - finding something to read is the first
   * thing a visitor does - with a daily allowance per account, or per
   * address when signed out.
   */
  @Post('discover')
  @Throttle(SEARCH_TIER)
  async discover(@Body() dto: DiscoverDto, @Req() req: Request) {
    const user = await this.currentUser.optional();
    // An account gets its own allowance only once its email is proven.
    // Otherwise registering accounts would be a way to mint allowances, so
    // an unproven account is counted with its network, like a visitor.
    const own = user && (!this.needVerified || user.emailVerifiedAt);
    const who = own ? `u:${user.id}` : `ip:${req.ip ?? 'unknown'}`;
    return this.discovery.search(dto.q, dto.previous, who);
  }

  /** Stories like this one, from the cards AI search already wrote. */
  @Get('stories/:id/related')
  relatedTo(@Param('id', ParseUUIDPipe) id: string) {
    return this.related.for(id);
  }

  /** How much of the catalogue AI search can see yet. */
  @Get('discover/coverage')
  coverage() {
    return this.cards.coverage();
  }
}

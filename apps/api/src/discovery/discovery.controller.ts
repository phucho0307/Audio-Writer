import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUserService } from '../auth/current-user.service';
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

@Controller('discover')
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly cards: StoryCardsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /**
   * Find stories from a description in the reader's own words. Open to
   * readers who are not signed in - finding something to read is the first
   * thing a visitor does - with a daily allowance per account, or per
   * address when signed out.
   */
  @Post()
  @Throttle(SEARCH_TIER)
  async discover(@Body() dto: DiscoverDto, @Req() req: Request) {
    const user = await this.currentUser.optional();
    const who = user ? `u:${user.id}` : `ip:${req.ip ?? 'unknown'}`;
    return this.discovery.search(dto.q, dto.previous, who);
  }

  /** How much of the catalogue AI search can see yet. */
  @Get('coverage')
  coverage() {
    return this.cards.coverage();
  }
}

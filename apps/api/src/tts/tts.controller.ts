import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { TtsService } from './tts.service';
import { DEFAULT_VOICE } from './gemini-tts.driver';
import { Throttle } from '@nestjs/throttler';
import { COSTLY_TIER } from '../throttler/tiers';

class VoiceDto {
  /**
   * Validated by the service against the active driver rather than by a
   * decorator, because the set of voices belongs to whichever provider is
   * configured and a decorator is fixed at import time.
   */
  @IsOptional()
  @IsString()
  voice?: string;
}

/**
 * Narration is queued, not performed here.
 *
 * The tight limit is per-route rather than on the controller. Only the two
 * POSTs spend anything - provider quota, measured in tens of requests a day
 * across the whole project. The reads cost a row lookup, and `jobs/:id` is
 * polled every couple of seconds by every reader waiting on a chapter, so
 * putting it on the costly tier throttles the client against itself. That is
 * exactly what happened the first time this was wired up.
 */
@Controller('audio')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get('voices')
  voices() {
    return { available: this.tts.available, ...this.tts.voices() };
  }

  /** Every chapter the reader may hear, and which already have narration. */
  @Get('branches/:id')
  list(@Param('id', ParseUUIDPipe) id: string, @Query('voice') voice?: string) {
    return this.tts.list(id, voice ?? DEFAULT_VOICE);
  }

  /** Where a queued narration has got to. The player polls this. */
  @Get('jobs/:id')
  job(@Param('id', ParseUUIDPipe) id: string) {
    return this.tts.jobStatus(id);
  }

  /**
   * Mode one: narrate a single chapter.
   *
   * 202, not 200 - the work has been accepted, not done. A chapter that was
   * already narrated comes back with `cached: true` and its url, and no job.
   */
  @Post('branches/:id/chapters/:depth')
  @Throttle(COSTLY_TIER)
  @HttpCode(HttpStatus.ACCEPTED)
  chapter(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depth', ParseIntPipe) depth: number,
    @Body() dto: VoiceDto,
  ) {
    return this.tts.enqueueChapter(id, depth, dto.voice ?? DEFAULT_VOICE);
  }

  /** Mode two: queue every chapter that has no narration yet. */
  @Post('branches/:id')
  @Throttle(COSTLY_TIER)
  @HttpCode(HttpStatus.ACCEPTED)
  branch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoiceDto) {
    return this.tts.enqueueBranch(id, dto.voice ?? DEFAULT_VOICE);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Paragraphs, Pov } from '@aw/shared';
import { LlmService } from './llm.service';
import { DevOnlyGuard } from '../auth/dev-only.guard';
import { Throttle } from '@nestjs/throttler';
import { COSTLY_TIER } from '../throttler/tiers';

class SeedDto {
  @IsOptional()
  @IsIn(['first', 'third_limited', 'third_omniscient'])
  pov?: Pov;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;

  @IsOptional()
  @IsIn([1, 2, 3])
  paragraphs?: Paragraphs;
}

class ContinueDto {
  @IsOptional()
  @IsIn(['first', 'third_limited', 'third_omniscient'])
  pov?: Pov;

  @IsOptional()
  @IsIn([1, 2, 3])
  paragraphs?: Paragraphs;
}

class SuggestDto {
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  count?: number;
}

class GrantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  amount?: number;
}

/**
 * Generation costs money and sits behind a 20-a-day free tier. The daily AI
 * quota already meters how much a person may generate; this limits how fast,
 * which is what stops one caller exhausting the shared key in a burst.
 */
@Throttle(COSTLY_TIER)
@Controller('ai')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Get('status')
  status() {
    return { available: this.llm.available, ...this.llm.currentModel() };
  }

  @Get('quota')
  quota() {
    return this.llm.quotaStatus();
  }

  /**
   * Stands in for the payment webhook so the paid path can be exercised before
   * checkout exists. Must not survive into production.
   */
  @Post('quota/grant')
  @UseGuards(DevOnlyGuard)
  grant(@Body() dto: GrantDto) {
    return this.llm.grantCredits(dto.amount ?? 10);
  }

  @Post('stories/:id/seed')
  async seed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SeedDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipe(res, () => this.llm.seed(id, dto));
  }

  @Post('branches/:id/continue')
  async continue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContinueDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.pipe(res, () => this.llm.continue(id, dto));
  }

  @Post('branches/:id/suggest')
  suggest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestDto,
  ) {
    return this.llm.suggest(id, dto.count ?? 4);
  }

  /**
   * Streams generated prose to the browser as server-sent events.
   *
   * Errors are tricky here: once the first byte is written the status code is
   * already sent, so a failure mid-stream cannot become a 400. It is emitted
   * as an `error` event instead and the client decides what to show. Failures
   * before the first byte still get a normal HTTP error.
   */
  private async pipe(
    res: Response,
    run: () => AsyncIterable<string>,
  ): Promise<void> {
    let started = false;

    try {
      for await (const chunk of run()) {
        if (!started) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();
          started = true;
        }
        res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }

      if (!started) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.flushHeaders();
      }
      res.write('event: done\ndata: {}\n\n');
      res.end();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'generation failed';
      const status =
        typeof (err as { status?: number }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      const body = (err as { response?: unknown }).response;

      if (!started) {
        res.status(status).json(body ?? { message });
        return;
      }
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.end();
    }
  }
}

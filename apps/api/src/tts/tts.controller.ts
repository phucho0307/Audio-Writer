import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { TtsService } from './tts.service';
import { DEFAULT_VOICE, VOICES } from './gemini-tts.driver';

const VOICE_IDS = VOICES.map((v) => v.id);

class VoiceDto {
  @IsOptional()
  @IsIn(VOICE_IDS)
  voice?: string;
}

@Controller('audio')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get('voices')
  voices() {
    return { available: this.tts.available, ...this.tts.voices() };
  }

  /** Every chapter the reader may hear, and which already have narration. */
  @Get('branches/:id')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('voice') voice?: string,
  ) {
    return this.tts.list(id, voice ?? DEFAULT_VOICE);
  }

  /** Mode one: narrate a single chapter. */
  @Post('branches/:id/chapters/:depth')
  chapter(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depth', ParseIntPipe) depth: number,
    @Body() dto: VoiceDto,
  ) {
    return this.tts.speakChapter(id, depth, dto.voice ?? DEFAULT_VOICE);
  }

  /** Mode two: narrate the whole branch, skipping anything already done. */
  @Post('branches/:id')
  branch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoiceDto,
  ) {
    return this.tts.speakBranch(id, dto.voice ?? DEFAULT_VOICE);
  }
}

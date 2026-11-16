import {
  Body, Controller, Delete, Param, ParseUUIDPipe, Post,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { COSTLY_TIER } from '../throttler/tiers';
import { StoryCoversService } from './story-covers.service';

class SuggestCoverDto {
  @IsOptional() @IsString() @MaxLength(300)
  hint?: string;

  @IsOptional() @IsInt() @Min(1) @Max(5)
  page?: number;
}

class SelectCoverDto {
  @IsUUID()
  searchId!: string;

  @IsString() @MaxLength(150)
  candidateId!: string;
}

@Controller('stories/:id/cover')
export class StoryCoversController {
  constructor(private readonly covers: StoryCoversService) {}

  @Post('upload')
  @Throttle(COSTLY_TIER)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
  }))
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file?.buffer) throw new BadRequestException('Chọn một ảnh để tải lên.');
    return this.covers.upload(id, file.buffer);
  }

  @Post('suggest')
  @Throttle(COSTLY_TIER)
  suggest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SuggestCoverDto) {
    return this.covers.suggest(id, dto.hint, dto.page);
  }

  @Post('select')
  @Throttle(COSTLY_TIER)
  select(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SelectCoverDto) {
    return this.covers.select(id, dto.searchId, dto.candidateId);
  }

  @Delete()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.covers.remove(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CollabRole } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { CollabAccessService } from './collab-access.service';
import { DraftService } from './draft.service';
import { COSTLY_TIER } from '../throttler/tiers';

class InviteDto {
  @IsString()
  @MaxLength(40)
  handle!: string;

  @IsOptional()
  @IsEnum(CollabRole)
  role?: CollabRole;
}

class CommitDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

class AiContinueDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  paragraphs?: number;

  @IsOptional()
  @IsIn(['first', 'third_limited'])
  pov?: 'first' | 'third_limited';
}

@Controller('branches/:id/draft')
export class CollabController {
  constructor(
    private readonly drafts: DraftService,
    private readonly access: CollabAccessService,
  ) {}

  /** The draft as text, for anything that is not the editor itself. */
  @Get()
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.read(id);
  }

  /** Who is in the room this second. */
  @Get('presence')
  presence(@Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.presence(id);
  }

  @Get('collaborators')
  async collaborators(@Param('id', ParseUUIDPipe) id: string) {
    await this.access.require(id, 'read');
    return this.access.list(id);
  }

  @Post('collaborators')
  invite(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InviteDto) {
    return this.access.invite(id, dto.handle, dto.role ?? CollabRole.EDITOR);
  }

  @Delete('collaborators/:userId')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.access.revoke(id, userId);
  }

  /** Turn the shared draft into an immutable chapter. */
  @Post('commit')
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitDraftDto,
  ) {
    return this.drafts.commit(id, dto.title);
  }

  /**
   * Ask the model to write into the room.
   *
   * On the costly tier with the other generation endpoints: it spends AI quota
   * and holds a provider stream open, and one writer hammering it would stall
   * the room for everybody else in it.
   */
  @Post('ai')
  @Throttle(COSTLY_TIER)
  ai(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AiContinueDto) {
    return this.drafts.aiContinue(id, dto);
  }
}

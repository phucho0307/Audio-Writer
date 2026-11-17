import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CommentsService } from './comments.service';

class CommentDto {
  @IsString()
  // Looser than the real limit: the service counts after cleaning, and says
  // why in Vietnamese.
  @MaxLength(4000)
  body!: string;
}

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /** Newest first, twenty at a time; `cursor` is the last id of the page before. */
  @Get('chapters/:id/comments')
  list(@Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string) {
    const valid = cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined;
    return this.comments.list(id, valid);
  }

  @Post('chapters/:id/comments')
  add(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.comments.add(id, dto.body);
  }

  @Delete('comments/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.comments.remove(id);
  }
}

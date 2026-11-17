import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FollowsService } from './follows.service';
import { ProgressService } from './progress.service';

class ProgressDto {
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsInt()
  @Min(0)
  @Max(100_000)
  depth!: number;

  /** Seconds. Two days is far past any chapter. */
  @IsNumber()
  @Min(0)
  @Max(172_800)
  at!: number;

  @IsNumber()
  @Min(0)
  updatedAt!: number;
}

@Controller()
export class ReadingController {
  constructor(
    private readonly progress: ProgressService,
    private readonly follows: FollowsService,
  ) {}

  // ---- where the reader stopped

  @Get('me/progress')
  listProgress() {
    return this.progress.list();
  }

  @Put('me/progress/:storyId')
  saveProgress(@Param('storyId', ParseUUIDPipe) storyId: string, @Body() dto: ProgressDto) {
    return this.progress.save(storyId, dto);
  }

  @Delete('me/progress/:storyId')
  forgetProgress(@Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.progress.forget(storyId);
  }

  // ---- following

  @Get('me/follows')
  myFollows() {
    return this.follows.mine();
  }

  @Get('stories/:id/follow')
  followState(@Param('id', ParseUUIDPipe) id: string) {
    return this.follows.state(id);
  }

  @Put('stories/:id/follow')
  follow(@Param('id', ParseUUIDPipe) id: string) {
    return this.follows.follow(id);
  }

  @Delete('stories/:id/follow')
  unfollow(@Param('id', ParseUUIDPipe) id: string) {
    return this.follows.unfollow(id);
  }

  @Post('stories/:id/follow/seen')
  seen(@Param('id', ParseUUIDPipe) id: string) {
    return this.follows.seen(id);
  }
}

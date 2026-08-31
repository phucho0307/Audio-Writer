import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { StoriesService } from './stories.service';
import { DevOnlyGuard } from '../auth/dev-only.guard';
import { PaywallService } from './paywall.service';
import {
  CommitContributionDto,
  CreateStoryDto,
  EditContributionDto,
  ForkBranchDto,
  GrantCreditsDto,
  UpdateStoryDto,
} from './dto';

@Controller()
export class StoriesController {
  constructor(
    private readonly stories: StoriesService,
    private readonly paywall: PaywallService,
  ) {}

  /** The public shelf, or your own workspace with ?mine=true. */
  @Get('stories')
  list(@Query('mine') mine?: string) {
    return this.stories.list(mine === 'true');
  }

  @Post('stories')
  create(@Body() dto: CreateStoryDto) {
    return this.stories.create(dto);
  }

  @Get('stories/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.get(id);
  }

  @Patch('stories/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryDto,
  ) {
    return this.stories.update(id, dto);
  }

  @Delete('stories/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.remove(id);
  }

  @Post('stories/:id/view')
  recordView(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.recordView(id);
  }

  @Post('stories/:id/unlock')
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.paywall.unlock(id);
  }

  @Get('me/wallet')
  wallet() {
    return this.paywall.wallet();
  }

  @Get('me/earnings')
  earnings() {
    return this.paywall.earnings();
  }

  /** Stands in for checkout. Must not survive into production. */
  @Post('me/credits/grant')
  @UseGuards(DevOnlyGuard)
  grantCredits(@Body() dto: GrantCreditsDto) {
    return this.paywall.grantReadCredits(dto.amount ?? 20);
  }

  /** The resolved reading view: inherited contributions plus this branch's own. */
  /** An editable copy of the published version, to revise and then promote. */
  @Post('stories/:id/revise')
  revise(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.revise(id);
  }

  /** Make this branch the one readers land on. */
  @Post('branches/:id/promote')
  promote(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.promote(id);
  }

  /** Owner-only, and only while nobody has forked from this chapter. */
  @Patch('contributions/:id')
  editChapter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditContributionDto,
  ) {
    return this.stories.editChapter(id, dto);
  }

  /** The last chapter of a branch. Repeat to remove more. */
  @Delete('contributions/:id')
  deleteChapter(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.deleteChapter(id);
  }

  @Get('branches/:id')
  readBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.stories.readBranch(id);
  }

  @Post('branches/:id/contributions')
  commit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitContributionDto,
  ) {
    return this.stories.commit(id, dto);
  }

  @Post('branches/:id/fork')
  fork(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ForkBranchDto) {
    return this.stories.fork(id, dto);
  }
}

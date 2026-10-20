import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ChunkKind, Genre } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from './rag.service';
import { DevOnlyGuard } from '../auth/dev-only.guard';
import { SEARCH_TIER } from '../throttler/tiers';

@Controller()
export class RagController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
  ) {}

  /**
   * The reference shelf: where to go and listen.
   *
   * Public and unauthenticated - it is a reading list, and a writer deciding
   * whether to sign up should be able to see it first.
   */
  @Get('references')
  async references(@Query('genre') genre?: Genre) {
    const sources = await this.prisma.referenceSource.findMany({
      where: genre ? { genres: { has: genre } } : undefined,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });

    const notes = await this.prisma.craftNote.findMany({
      where: genre ? { genre } : undefined,
      orderBy: [{ genre: 'asc' }, { kind: 'asc' }],
      select: {
        id: true,
        kind: true,
        genre: true,
        title: true,
        body: true,
        source: { select: { name: true, url: true } },
      },
    });

    return { sources, notes };
  }

  /**
   * What the model would retrieve for a given line.
   *
   * Exposed because retrieval is the part of a generation pipeline that fails
   * silently: a bad continuation and a continuation drawn from the wrong
   * passages look identical from the outside. Being able to ask "what did it
   * read?" is the difference between debugging it and guessing.
   */
  @Get('rag/search')
  @Throttle(SEARCH_TIER)
  search(
    @Query('q') q: string,
    @Query('genre') genre?: Genre,
    @Query('storyId') storyId?: string,
    @Query('kind') kind?: ChunkKind,
  ) {
    return this.rag.search(q ?? '', {
      genre: genre ?? null,
      storyId: storyId ?? null,
      kinds: kind ? [kind] : undefined,
    });
  }

  @Get('rag/stats')
  stats() {
    return this.rag.stats();
  }

  /** Rebuild the craft half of the index. Chapters index themselves on commit. */
  @Post('rag/reindex')
  @UseGuards(DevOnlyGuard)
  reindex() {
    return this.rag.indexCraftNotes();
  }
}

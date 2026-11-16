import { Controller, Get, Query } from '@nestjs/common';
import { Genre } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class ReferencesController {
  constructor(private readonly prisma: PrismaService) {}

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
}

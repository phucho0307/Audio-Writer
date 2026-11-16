import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BoardKind, RankingsService } from './rankings.service';

@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  /** GET /rankings?kind=best|hot&genre=Ngôn%20tình&limit=20 */
  @Get()
  board(@Query('kind') kind = 'best', @Query('genre') genre?: string, @Query('limit') limit?: string) {
    if (kind !== 'best' && kind !== 'hot') {
      throw new BadRequestException({ code: 'RANKING_KIND', message: 'kind phải là best hoặc hot.' });
    }
    const g = genre?.trim().slice(0, 60) || null;
    return this.rankings.board(kind as BoardKind, g, Number(limit) || 20);
  }

  /** Genres to rank within, most stories first. */
  @Get('genres')
  genres() {
    return this.rankings.genres();
  }
}

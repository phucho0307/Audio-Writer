import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { RatingsService } from './ratings.service';

class RateDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}

@Controller('stories/:id/rating')
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  /** Average, count, and whether (and how) the caller has rated. */
  @Get()
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.ratings.summary(id);
  }

  @Put()
  rate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDto) {
    return this.ratings.rate(id, dto.stars);
  }

  @Delete()
  unrate(@Param('id', ParseUUIDPipe) id: string) {
    return this.ratings.unrate(id);
  }
}

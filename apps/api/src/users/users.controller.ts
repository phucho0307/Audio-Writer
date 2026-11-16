import { Body, Controller, Delete, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { COSTLY_TIER } from '../throttler/tiers';
import { AVATAR_MAX_BYTES, BIO_MAX, NAME_MAX, UsersService } from './users.service';

class ProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX * 2)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  handle?: string;

  // null clears it.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(BIO_MAX * 2)
  bio?: string | null;
}

class AvatarDto {
  /** A data: URL. Base64 is a third larger than the bytes it carries. */
  @IsString()
  @MaxLength(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 100)
  image!: string;
}

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/profile')
  mine() {
    return this.users.mine();
  }

  @Patch('me/profile')
  update(@Body() dto: ProfileDto) {
    return this.users.update(dto);
  }

  @Put('me/avatar')
  @Throttle(COSTLY_TIER)
  setAvatar(@Body() dto: AvatarDto) {
    return this.users.setAvatar(dto.image);
  }

  @Delete('me/avatar')
  clearAvatar() {
    return this.users.clearAvatar();
  }

  /** For the settings form, as the user types. */
  @Get('me/handle-check')
  async check(@Query('handle') handle = '') {
    const me = await this.users.mine();
    const h = handle.trim().replace(/^@/, '').toLowerCase();
    const problem = h === me.handle ? null : await this.users.handleProblem(h, me.id);
    return { handle: h, available: problem === null, problem };
  }

  @Get('users/:handle')
  profile(@Param('handle') handle: string) {
    return this.users.profile(handle);
  }
}

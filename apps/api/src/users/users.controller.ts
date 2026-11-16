import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BIO_MAX, NAME_MAX, UsersService } from './users.service';

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

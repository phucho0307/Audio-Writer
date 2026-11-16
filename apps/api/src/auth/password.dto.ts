import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Mật khẩu cần ít nhất 8 ký tự.' })
  // argon2 hashes any length, but an unbounded field is a free CPU sink.
  @MaxLength(128, { message: 'Mật khẩu tối đa 128 ký tự.' })
  password!: string;

  @IsString()
  @MinLength(1, { message: 'Hãy nhập tên hiển thị.' })
  @MaxLength(40, { message: 'Tên hiển thị tối đa 40 ký tự.' })
  displayName!: string;
}

export class LoginDto {
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

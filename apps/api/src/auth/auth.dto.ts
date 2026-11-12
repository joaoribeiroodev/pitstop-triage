import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  refresh_token: string;
}

export class PasswordResetDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class NewPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

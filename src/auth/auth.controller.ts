import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../types/auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  UpdateProfileDto,
  UserDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'email already exists' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid credentials' })
  @ApiTooManyRequestsResponse({ description: 'too many login attempts' })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthResponseDto> {
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'refresh token invalid or expired' })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  logout(@Body() dto: RefreshDto, @CurrentUser() me: AuthUser): Promise<void> {
    return this.auth.logout(dto.refresh_token, me);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() me: AuthUser): Promise<UserDto> {
    return this.auth.me(me);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  updateMe(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() me: AuthUser,
  ): Promise<UserDto> {
    return this.auth.updateProfile(me, dto.display_name);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'old password incorrect' })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() me: AuthUser,
  ): Promise<void> {
    return this.auth.changePassword(me, dto);
  }
}

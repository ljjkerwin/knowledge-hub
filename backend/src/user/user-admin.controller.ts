import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { RoleCode } from './entities/role.entity';
import { UserStatus } from './entities/user.entity';
import { UserAdminService } from './user-admin.service';

class UserDtoBase {
  @IsString() @Matches(/^[A-Za-z0-9_.-]{3,50}$/) username: string;
  @IsEmail() @MaxLength(100) email: string;
  @IsOptional() @IsString() @MaxLength(50) nickname?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsIn([UserStatus.Active, UserStatus.Disabled]) status: UserStatus;
  @IsArray() @IsString({ each: true }) roleIds: string[];
}

class CreateUserDto extends UserDtoBase {
  @IsString() @MinLength(8) @MaxLength(100) password: string;
}

class UpdateUserDto extends UserDtoBase {}

@Controller('users')
@Roles(RoleCode.Admin)
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}
  @Get() list() {
    return this.userAdminService.list();
  }
  @Post() create(
    @Body() dto: CreateUserDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.userAdminService.create(dto, req.user.id);
  }
  @Put(':id') update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.userAdminService.update(id, dto, req.user.id);
  }
  @Delete(':id') remove(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.userAdminService.remove(id, req.user.id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RoleCode } from '../user/entities/role.entity';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamService } from './team.service';

/** 公司组织架构管理，仅管理员可访问。 */
@Controller('teams')
@Roles(RoleCode.Admin)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  listTree() {
    return this.teamService.listTree();
  }

  @Get('users')
  listUsers() {
    return this.teamService.listUsers();
  }

  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.teamService.remove(id);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: AddTeamMemberDto) {
    return this.teamService.addMember(id, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.teamService.removeMember(id, userId);
  }
}

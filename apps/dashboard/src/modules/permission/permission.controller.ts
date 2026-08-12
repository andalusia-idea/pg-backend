import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { PermissionDto } from './dto/permission.dto';
import { PermissionService } from './permission.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  /**
   * Deliberately open to every authenticated role, not gated with @Roles:
   * the frontend calls this on login to build its CASL ability and render the
   * menu, so restricting it to admins would leave agent and merchant sessions
   * with no navigation at all. See the finding in docs/dashboard-migration.md.
   */
  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'List all permissions' })
  @ApiOkResponse({ type: PermissionDto, isArray: true })
  findAll(): Promise<PermissionDto[]> {
    return this.permissionService.findAll();
  }

  @Get(':id')
  @CheckPolicies()
  @ApiOperation({ summary: 'Permission by id' })
  @ApiOkResponse({ type: PermissionDto })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<PermissionDto> {
    return this.permissionService.findOneThrow(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterStudentsService } from './center-students.service';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import {
  ActivationKeyDto,
  CenterStudentDto,
  CenterStudentListDto,
  ListStudentsQueryDto,
  ProvisionStudentDto,
  ProvisionedStudentDto,
  UpdateStudentDto,
} from './dto/center-students.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CenterSubscriptionGuard } from './guards/center-subscription.guard';
import { StudentProvisioningService } from './student-provisioning.service';

@ApiTags('Center Students')
@ApiBearerAuth()
@Controller('api/centers/me/students')
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class CenterStudentsController {
  constructor(
    private readonly students: CenterStudentsService,
    private readonly provisioning: StudentProvisioningService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List the students of the signed-in center',
    description:
      'Paginated, and scoped to this center. There is no route that lists another center students.',
  })
  @ApiOkResponse({ type: CenterStudentListDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  async list(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Query() query: ListStudentsQueryDto,
  ): Promise<CenterStudentListDto> {
    return this.students.list(centerUser, query);
  }

  // Guarded, unlike the reads below: this is where a center consumes a seat
  // and grants somebody new access to the product.
  @Post()
  @UseGuards(CenterSubscriptionGuard)
  @ApiOperation({
    summary: 'Provision a student and mint their first activation key',
    description:
      'Counts seats and inserts in one transaction, so two administrators cannot both take the last seat. The activation key is returned once and cannot be recovered later.',
  })
  @ApiCreatedResponse({ type: ProvisionedStudentDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiForbiddenResponse({
    type: CenterErrorResponseDto,
    description: 'SEAT_LIMIT_REACHED — every seat is in use.',
  })
  @ApiConflictResponse({
    type: CenterErrorResponseDto,
    description:
      'STUDENT_EMAIL_ALREADY_EXISTS — the address belongs to someone.',
  })
  async provision(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: ProvisionStudentDto,
  ): Promise<ProvisionedStudentDto> {
    return this.provisioning.provision(
      centerUser,
      dto,
    ) as Promise<ProvisionedStudentDto>;
  }

  @Get(':studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read one student of the signed-in center',
    description:
      'A student of another center answers 404, never 403 — a 403 would confirm the id exists.',
  })
  @ApiOkResponse({ type: CenterStudentDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async get(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('studentId') studentId: string,
  ): Promise<CenterStudentDto> {
    return this.students.get(centerUser, studentId);
  }

  @Patch(':studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a student name or phone',
    description:
      'Name and phone only. Email is identity, and a center can never set a password or move a student to another center.',
  })
  @ApiOkResponse({ type: CenterStudentDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async update(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('studentId') studentId: string,
    @Body() dto: UpdateStudentDto,
  ): Promise<CenterStudentDto> {
    return this.students.update(centerUser, studentId, dto);
  }

  @Delete(':studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a student from the center, freeing their seat',
    description:
      'Unlinks rather than deletes. The seat frees immediately; the account, the password the student chose and all their learning history survive.',
  })
  @ApiOkResponse({ schema: { example: { removed: true } } })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async remove(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('studentId') studentId: string,
  ): Promise<{ removed: true }> {
    return this.students.remove(centerUser, studentId);
  }

  // Also guarded: a key is access, so re-issuing one to a blocked center
  // would hand out exactly what the block is meant to withhold.
  @Post(':studentId/activation-key')
  @UseGuards(CenterSubscriptionGuard)
  @ApiOperation({
    summary: 'Mint a replacement activation key',
    description:
      'For a student who lost their key or whose key expired. Refused once the student has activated, because re-keying a live account would take it from its owner.',
  })
  @ApiCreatedResponse({ type: ActivationKeyDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async issueActivationKey(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('studentId') studentId: string,
  ): Promise<ActivationKeyDto> {
    return this.students.issueActivationKey(centerUser, studentId);
  }

  @Delete(':studentId/activation-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an outstanding activation key' })
  @ApiOkResponse({ schema: { example: { revoked: true } } })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  async revokeActivationKey(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Param('studentId') studentId: string,
  ): Promise<{ revoked: true }> {
    return this.students.revokeActivationKey(centerUser, studentId);
  }
}

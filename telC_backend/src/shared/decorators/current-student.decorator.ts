import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload } from '../interfaces/token-payload.interface';

/**
 * Custom decorator to extract the current student from the request.
 * Must be used with JwtAuthGuard which attaches the decoded token to request.student.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard)
 *   @Get('profile')
 *   getProfile(@CurrentStudent() student: AccessTokenPayload) {
 *     console.log(student.studentId);
 *   }
 *
 *   // Or extract a specific field:
 *   @Get('profile')
 *   getProfile(@CurrentStudent('studentId') studentId: string) {
 *     console.log(studentId);
 *   }
 */
export const CurrentStudent = createParamDecorator(
  (data: keyof AccessTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const student = request.student as AccessTokenPayload;

    if (!student) {
      return null;
    }

    return data ? student[data] : student;
  },
);

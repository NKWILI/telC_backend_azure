import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

const CENTER_ERROR_MESSAGES: Record<string, string> = {
  EMAIL_DELIVERY_FAILED: 'Verification email delivery failed.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please try again later.',
};

@Catch()
export class CenterExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected error',
      });
      return;
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      response.status(status).json({
        error: payload,
        message: CENTER_ERROR_MESSAGES[payload] || payload,
      });
      return;
    }

    if (typeof payload === 'object' && payload !== null) {
      const body = payload as Record<string, unknown>;
      if (Array.isArray(body.message)) {
        response.status(status).json({
          error: 'VALIDATION_ERROR',
          message: body.message,
        });
        return;
      }

      if (typeof body.message === 'string') {
        const code = body.message;
        response.status(status).json({
          error: code,
          message: CENTER_ERROR_MESSAGES[code] || code,
        });
        return;
      }
    }

    response.status(status).json({
      error: 'REQUEST_FAILED',
      message: 'Request failed',
    });
  }
}

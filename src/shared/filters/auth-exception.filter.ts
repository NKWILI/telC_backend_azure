import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AUTH_ERROR_MESSAGES } from '../../modules/auth/auth.errors';

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isAuthRoute = request.url.startsWith('/api/auth');
    if (!isAuthRoute) {
      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        response.status(status).json(exception.getResponse());
        return;
      }
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected error',
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        const errorCode = payload;
        response.status(status).json({
          error: errorCode,
          message: AUTH_ERROR_MESSAGES[errorCode] || errorCode,
        });
        return;
      }

      if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload
      ) {
        const messageValue = (payload as { message: unknown }).message;
        if (Array.isArray(messageValue)) {
          response.status(status).json({
            error: 'VALIDATION_ERROR',
            message: messageValue,
          });
          return;
        }
        if (typeof messageValue === 'string') {
          const errorCode = messageValue;
          response.status(status).json({
            error: errorCode,
            message: AUTH_ERROR_MESSAGES[errorCode] || errorCode,
          });
          return;
        }
      }

      response.status(status).json({
        error: 'UNKNOWN_ERROR',
        message: 'Unexpected error',
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected error',
    });
  }
}

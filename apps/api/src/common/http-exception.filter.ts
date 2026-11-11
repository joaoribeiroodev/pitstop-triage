import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@pitstop/shared-types';

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

const PG_ERRORS: Record<string, { status: number; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Já existe um registro com esses dados.' },
  '23503': { status: HttpStatus.CONFLICT, message: 'Operação bloqueada: o registro está vinculado a outros dados.' },
  '23514': { status: HttpStatus.BAD_REQUEST, message: 'Dados fora das regras permitidas.' },
  '23502': { status: HttpStatus.BAD_REQUEST, message: 'Campo obrigatório ausente.' },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Formato de dado inválido.' },
  '42501': { status: HttpStatus.FORBIDDEN, message: 'Operação não permitida.' }
};

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable'
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Erro interno. Tente novamente em instantes.';
    let error = STATUS_NAMES[500];
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const payload = body as { message?: string | string[]; error?: string; code?: string };
        message = payload.message ?? exception.message;
        code = payload.code;
      }
      error = STATUS_NAMES[status] ?? exception.name;
    } else if (isPgError(exception) && PG_ERRORS[exception.code as string]) {
      const mapped = PG_ERRORS[exception.code as string];
      status = mapped.status;
      message = mapped.message;
      error = STATUS_NAMES[status];
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    // O token do portal faz parte da URL: nunca devolvê-lo (nem registrá-lo) em claro.
    const path = String(request.originalUrl ?? request.url).replace(/(\/portal\/)[^/?]+/, '$1:token');
    const body: ApiError & { code?: string } = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path
    };
    if (code) body.code = code;
    response.status(status).json(body);
  }
}

function isPgError(exception: unknown): exception is PgError {
  return typeof exception === 'object' && exception !== null && typeof (exception as PgError).code === 'string';
}

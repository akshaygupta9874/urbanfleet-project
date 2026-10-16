export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  service?: string;
  requestId?: string;
  userId?: string;
  rideId?: string;
  [key: string]: any;
}

export class StructuredLogger {
  constructor(private serviceName: string) {}

  private format(level: LogLevel, message: string, context?: LogContext): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message,
      ...context
    });
  }

  public info(message: string, context?: LogContext): void {
    console.log(this.format('info', message, context));
  }

  public warn(message: string, context?: LogContext): void {
    console.warn(this.format('warn', message, context));
  }

  public error(message: string, error?: Error | any, context?: LogContext): void {
    const errorDetails = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : { rawError: error };

    console.error(this.format('error', message, { ...context, error: errorDetails }));
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.format('debug', message, context));
    }
  }
}

export const createLogger = (serviceName: string) => new StructuredLogger(serviceName);

import { sanitizeLogMetadata } from '@hrbot/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private readonly minPriority: number;

  constructor(level: LogLevel = 'info', private readonly component = 'bot') {
    this.minPriority = LEVEL_PRIORITY[level] ?? 20;
  }

  child(subComponent: string): Logger {
    const levelEntry = (Object.entries(LEVEL_PRIORITY).find(
      ([, p]) => p === this.minPriority
    )?.[0] ?? 'info') as LogLevel;
    return new Logger(levelEntry, `${this.component}:${subComponent}`);
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.write('debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.write('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.write('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.write('error', msg, meta);
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < this.minPriority) {
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
      ...(meta ? sanitizeLogMetadata(meta) : {}),
    };

    const serialized = JSON.stringify(entry);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }
}


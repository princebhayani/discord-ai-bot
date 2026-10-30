/**
 * Concurrency semaphore limiting global simultaneous Groq API calls across all active tickets.
 */
export class GlobalSemaphore {
  private activeCount = 0;
  private maxConcurrent: number;
  private readonly waiters: Array<() => void> = [];

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  setLimit(limit: number): void {
    this.maxConcurrent = Math.max(1, limit);
    this.drain();
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new Error('Ticket operation aborted before acquiring semaphore');
    }

    await this.acquire(signal);
    try {
      if (signal?.aborted) {
        throw new Error('Ticket operation aborted after acquiring semaphore');
      }
      return await fn();
    } finally {
      this.activeCount--;
      this.drain();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onAcquire = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        this.activeCount++;
        resolve();
      };

      const onAbort = () => {
        const idx = this.waiters.indexOf(onAcquire);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        reject(new Error('Ticket operation aborted while waiting for global concurrency slot'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waiters.push(onAcquire);
    });
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}

/**
 * Per-ticket sequential execution queue + per-ticket cancellation & duplicate message protection.
 * Guarantees:
 * - Messages inside a single ticket are processed strictly sequentially (FIFO).
 * - Independent tickets run concurrently in parallel.
 * - Closing a ticket immediately aborts its AbortSignal and blocks further tasks.
 */
export class TicketQueueManager {
  private readonly ticketChains = new Map<string, Promise<void>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly closingChannels = new Set<string>();
  private readonly seenMessageIds = new Map<string, number>();
  private readonly ticketTurnTimestamps = new Map<string, number[]>();
  private readonly maxSeenCacheSize = 500;
  private shuttingDown = false;

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Stops accepting new ticket tasks during graceful process shutdown while allowing
   * currently running in-flight tasks a bounded window to complete.
   */
  beginShutdown(): void {
    this.shuttingDown = true;
  }

  getInFlightCount(): number {
    return this.ticketChains.size;
  }

  /**
   * Waits up to timeoutMs for active ticket chains to settle; aborts remaining operations on timeout.
   */
  async waitForInFlightTasks(
    timeoutMs: number
  ): Promise<{ completedCleanly: boolean; remainingCount: number }> {
    const activePromises = Array.from(this.ticketChains.values());
    if (activePromises.length === 0) {
      return { completedCleanly: true, remainingCount: 0 };
    }

    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, Math.max(100, timeoutMs));
      timer.unref?.();
    });

    await Promise.race([Promise.allSettled(activePromises).then(() => undefined), timeoutPromise]);
    if (timer) {
      clearTimeout(timer);
    }

    if (timedOut && this.ticketChains.size > 0) {
      for (const controller of this.abortControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      }
      return { completedCleanly: false, remainingCount: this.ticketChains.size };
    }

    return { completedCleanly: true, remainingCount: 0 };
  }

  /**
   * Clears all transient in-memory queue structures on final process exit.
   */
  clearMemoryState(): void {
    for (const controller of this.abortControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
    this.abortControllers.clear();
    this.ticketChains.clear();
    this.closingChannels.clear();
    this.seenMessageIds.clear();
    this.ticketTurnTimestamps.clear();
  }

  getOrCreateSignal(channelId: string): AbortSignal {
    let controller = this.abortControllers.get(channelId);
    if (!controller) {
      controller = new AbortController();
      this.abortControllers.set(channelId, controller);
    }
    return controller.signal;
  }

  isClosingOrAborted(channelId: string): boolean {
    if (this.closingChannels.has(channelId)) {
      return true;
    }
    return Boolean(this.abortControllers.get(channelId)?.signal.aborted);
  }

  markMessageSeen(discordMessageId: string): boolean {
    if (this.seenMessageIds.has(discordMessageId)) {
      return false;
    }
    if (this.seenMessageIds.size >= this.maxSeenCacheSize) {
      const oldestKey = this.seenMessageIds.keys().next().value;
      if (oldestKey) {
        this.seenMessageIds.delete(oldestKey);
      }
    }
    this.seenMessageIds.set(discordMessageId, Date.now());
    return true;
  }

  checkTicketRateLimit(channelId: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const cutoff = now - 60_000;
    const recent = (this.ticketTurnTimestamps.get(channelId) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= maxPerMinute) {
      this.ticketTurnTimestamps.set(channelId, recent);
      return false;
    }
    recent.push(now);
    this.ticketTurnTimestamps.set(channelId, recent);
    return true;
  }

  enqueueForTicket<T>(
    channelId: string,
    task: (signal: AbortSignal) => Promise<T>
  ): Promise<T | undefined> {
    if (this.shuttingDown || this.isClosingOrAborted(channelId)) {
      return Promise.resolve(undefined);
    }

    const signal = this.getOrCreateSignal(channelId);
    const previous = this.ticketChains.get(channelId) ?? Promise.resolve();

    let resultValue: T | undefined;
    let taskError: unknown;

    const nextChain = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.isClosingOrAborted(channelId) || signal.aborted) {
          return;
        }
        try {
          resultValue = await task(signal);
        } catch (err) {
          taskError = err;
        }
      });

    this.ticketChains.set(channelId, nextChain);

    return nextChain.then(() => {
      if (this.ticketChains.get(channelId) === nextChain) {
        this.ticketChains.delete(channelId);
      }
      if (taskError !== undefined) {
        throw taskError;
      }
      return resultValue;
    });
  }

  abortTicket(channelId: string): void {
    this.closingChannels.add(channelId);
    const controller = this.abortControllers.get(channelId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  finalizeTicketCleanup(channelId: string): void {
    this.abortControllers.delete(channelId);
    this.ticketChains.delete(channelId);
    this.ticketTurnTimestamps.delete(channelId);
    this.closingChannels.delete(channelId);
  }
}


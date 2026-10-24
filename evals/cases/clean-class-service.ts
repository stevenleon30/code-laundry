export interface Clock {
  now(): Date;
}

export interface Repo<T> {
  get(id: string): Promise<T | undefined>;
  put(id: string, value: T): Promise<void>;
}

export interface Session {
  userId: string;
  expiresAt: Date;
}

export class SessionService {
  constructor(
    private readonly repo: Repo<Session>,
    private readonly clock: Clock,
  ) {}

  async isActive(id: string): Promise<boolean> {
    const session = await this.repo.get(id);
    return session !== undefined && session.expiresAt > this.clock.now();
  }
}

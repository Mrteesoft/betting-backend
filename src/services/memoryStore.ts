type StringEntry = {
  type: "string";
  value: string;
};

type HashEntry = {
  type: "hash";
  value: Map<string, string>;
};

type SetEntry = {
  type: "set";
  value: Set<string>;
};

type StoreEntry = StringEntry | HashEntry | SetEntry;

export type StorePipelineResult = Array<[Error | null, unknown]>;

export interface StorePipelineLike {
  sismember(key: string, member: string): StorePipelineLike;
  exec(): Promise<StorePipelineResult>;
}

export interface StoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<"OK" | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hset(key: string, ...entries: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hscan(key: string, cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  call(command: string, ...args: string[]): Promise<unknown>;
  pipeline(): StorePipelineLike;
}

class MemoryPipeline implements StorePipelineLike {
  private readonly commands: Array<() => Promise<unknown>> = [];

  constructor(private readonly store: MemoryStore) {}

  sismember(key: string, member: string) {
    this.commands.push(() => this.store.sismember(key, member));
    return this;
  }

  async exec(): Promise<StorePipelineResult> {
    const results: StorePipelineResult = [];

    for (const command of this.commands) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await command();
        results.push([null, value]);
      } catch (error) {
        results.push([error instanceof Error ? error : new Error(String(error)), null]);
      }
    }

    return results;
  }
}

export class MemoryStore implements StoreLike {
  private readonly store = new Map<string, StoreEntry>();
  private readonly expiries = new Map<string, number>();

  private purgeExpired(key: string) {
    const expiresAt = this.expiries.get(key);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.expiries.delete(key);
      this.store.delete(key);
    }
  }

  private setExpiry(key: string, seconds: number) {
    this.expiries.set(key, Date.now() + seconds * 1000);
  }

  private getStringEntry(key: string): StringEntry | null {
    this.purgeExpired(key);
    const entry = this.store.get(key);
    return entry?.type === "string" ? entry : null;
  }

  private getHashEntry(key: string): HashEntry | null {
    this.purgeExpired(key);
    const entry = this.store.get(key);
    return entry?.type === "hash" ? entry : null;
  }

  private getSetEntry(key: string): SetEntry | null {
    this.purgeExpired(key);
    const entry = this.store.get(key);
    return entry?.type === "set" ? entry : null;
  }

  async get(key: string) {
    return this.getStringEntry(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    this.purgeExpired(key);

    let exSeconds: number | undefined;
    let requireNx = false;

    for (let index = 0; index < args.length; index += 1) {
      const token = String(args[index]).toUpperCase();
      if (token === "EX") {
        exSeconds = Number(args[index + 1]);
        index += 1;
        continue;
      }

      if (token === "NX") {
        requireNx = true;
      }
    }

    if (requireNx && this.store.has(key)) {
      return null;
    }

    this.store.set(key, {
      type: "string",
      value
    });

    if (typeof exSeconds === "number" && Number.isFinite(exSeconds) && exSeconds > 0) {
      this.setExpiry(key, exSeconds);
    } else {
      this.expiries.delete(key);
    }

    return "OK";
  }

  async incr(key: string) {
    const current = Number(this.getStringEntry(key)?.value ?? "0");
    const nextValue = Number.isFinite(current) ? current + 1 : 1;
    this.store.set(key, {
      type: "string",
      value: String(nextValue)
    });
    return nextValue;
  }

  async expire(key: string, seconds: number) {
    this.purgeExpired(key);
    if (!this.store.has(key)) {
      return 0;
    }

    this.setExpiry(key, seconds);
    return 1;
  }

  async hget(key: string, field: string) {
    return this.getHashEntry(key)?.value.get(field) ?? null;
  }

  async hmget(key: string, ...fields: string[]) {
    const hash = this.getHashEntry(key)?.value;
    return fields.map((field) => hash?.get(field) ?? null);
  }

  async hset(key: string, ...entries: string[]) {
    const hash = this.getHashEntry(key)?.value ?? new Map<string, string>();
    let created = 0;

    for (let index = 0; index < entries.length; index += 2) {
      const field = entries[index];
      const value = entries[index + 1];
      if (value === undefined) {
        continue;
      }

      if (!hash.has(field)) {
        created += 1;
      }

      hash.set(field, value);
    }

    this.store.set(key, {
      type: "hash",
      value: hash
    });

    return created;
  }

  async hgetall(key: string) {
    const hash = this.getHashEntry(key)?.value;
    if (!hash) {
      return {};
    }

    return [...hash.entries()].reduce<Record<string, string>>((acc, [field, value]) => {
      acc[field] = value;
      return acc;
    }, {});
  }

  async hscan(key: string, cursor: string, ..._args: Array<string | number>): Promise<[string, string[]]> {
    if (cursor !== "0") {
      return ["0", []];
    }

    const hash = this.getHashEntry(key)?.value;
    if (!hash) {
      return ["0", []];
    }

    const items: string[] = [];
    hash.forEach((value, field) => {
      items.push(field, value);
    });

    return ["0", items];
  }

  async sadd(key: string, ...members: string[]) {
    const set = this.getSetEntry(key)?.value ?? new Set<string>();
    let added = 0;

    members.forEach((member) => {
      if (!set.has(member)) {
        added += 1;
      }
      set.add(member);
    });

    this.store.set(key, {
      type: "set",
      value: set
    });

    return added;
  }

  async srem(key: string, ...members: string[]) {
    const set = this.getSetEntry(key)?.value;
    if (!set) {
      return 0;
    }

    let removed = 0;
    members.forEach((member) => {
      if (set.delete(member)) {
        removed += 1;
      }
    });

    return removed;
  }

  async sismember(key: string, member: string) {
    return this.getSetEntry(key)?.value.has(member) ? 1 : 0;
  }

  async call(command: string, ...args: string[]) {
    if (command.toUpperCase() === "SMISMEMBER") {
      const [key, ...members] = args;
      return Promise.all(members.map((member) => this.sismember(key, member)));
    }

    throw new Error(`Unsupported memory-store command: ${command}`);
  }

  pipeline() {
    return new MemoryPipeline(this);
  }
}

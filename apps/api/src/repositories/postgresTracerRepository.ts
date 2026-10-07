import postgres from "postgres";
import { FileTracerRepository } from "./fileTracerRepository";
import { clone, emptyStore, type StoreState } from "./fileStore";

/**
 * Keeps the existing repository semantics while making each write atomic and
 * durable across API restarts. The row lock also serializes monitoring and
 * extension requests when they arrive at the same time.
 */
export class PostgresTracerRepository extends FileTracerRepository {
  private readonly sql: ReturnType<typeof postgres>;
  private initialized: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    super("");
    this.sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, prepare: false });
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  protected override async read(): Promise<StoreState> {
    await this.initialize();
    const rows = await this.sql<{ state: StoreState }[]>`
      SELECT state FROM tracer_state WHERE id = 1
    `;
    return decodeState(rows[0]?.state ?? emptyStore);
  }

  protected override async mutate<T>(mutator: (state: StoreState) => T): Promise<T> {
    await this.initialize();
    const committed = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ state: StoreState }[]>`
        SELECT state FROM tracer_state WHERE id = 1 FOR UPDATE
      `;
      const state = decodeState(rows[0]?.state ?? emptyStore);
      const result = mutator(state);
      await transaction`
        UPDATE tracer_state SET state = ${this.sql.json(state as unknown as postgres.JSONValue)}::jsonb WHERE id = 1
      `;
      return { result };
    });
    return committed.result;
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.sql.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(71304201)`;
        await transaction`
          CREATE TABLE IF NOT EXISTS tracer_state (
            id integer PRIMARY KEY CHECK (id = 1),
            state jsonb NOT NULL
          )
        `;
        await transaction`
          INSERT INTO tracer_state (id, state)
          VALUES (1, ${this.sql.json(emptyStore as unknown as postgres.JSONValue)}::jsonb)
          ON CONFLICT (id) DO NOTHING
        `;
      });
    })().catch((error: unknown) => {
      this.initialized = null;
      throw error;
    });
    return this.initialized;
  }
}

function decodeState(raw: unknown): StoreState {
  // Earlier deployments serialized the state before passing it to postgres.js,
  // which serialized it again and stored a JSONB string. Decode those rows once
  // without replacing any existing purchases or price history.
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Tracer database state");
  }
  const state = value as Record<string, unknown>;
  if (
    !Array.isArray(state.products) ||
    !Array.isArray(state.purchases) ||
    !Array.isArray(state.observations) ||
    !Array.isArray(state.opportunities) ||
    !Array.isArray(state.activityEvents) ||
    !Array.isArray(state.monitoringPreferences)
  ) {
    throw new Error("Invalid Tracer database state");
  }
  return clone(state as unknown as StoreState);
}

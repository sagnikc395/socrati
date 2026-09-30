import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnvFiles } from '../load-env';

let client: postgres.Sql | undefined;
let db: ReturnType<typeof createDb> | undefined;

export function createDb(connectionString = getDatabaseUrl()) {
    return drizzle(postgres(connectionString, { max: 10 }), { schema });
}

/** Pooled singleton for the worker and route handlers. */
export function getDb(): ReturnType<typeof createDb> {
    loadEnvFiles();
    db ??= createDb();
    return db;
}

export function getDatabaseUrl(): string {
    loadEnvFiles();
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            'DATABASE_URL is missing. Set it to the Supabase pooled connection string (Transaction pooler, port 6543), e.g. postgresql://postgres.<ref>:<password>@<host>:6543/postgres.',
        );
    }
    return url;
}

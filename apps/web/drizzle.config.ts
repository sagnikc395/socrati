import { defineConfig } from 'drizzle-kit';
import { loadEnvFiles } from './lib/load-env';

loadEnvFiles();

export default defineConfig({
    schema: './lib/db/schema.ts',
    out: '../../supabase/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/postgres',
    },
});

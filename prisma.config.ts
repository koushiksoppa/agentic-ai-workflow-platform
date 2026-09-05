import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of schema.prisma. The CLI reads it
 * from here for migrate and studio; the runtime client builds its own driver
 * adapter in src/lib/db/client.ts.
 *
 * dotenv is imported explicitly — the CLI does not load .env on its own, and
 * env() resolves at config load time.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});

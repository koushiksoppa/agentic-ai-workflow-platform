import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma";

/**
 * Next's dev server re-evaluates modules on every hot reload. Without a global
 * cache that would open a new SQLite connection each time until the process
 * runs out of handles.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and re-run `npx prisma migrate dev`.",
    );
  }
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Drop every table and rebuild the schema from scratch.
 *
 * This is destructive by design and refuses to run against anything other than
 * a local file database, so pointing DATABASE_URL at a real Postgres or a
 * shared file cannot wipe it by accident.
 */

import { existsSync, rmSync } from 'node:fs';

import { appliedMigrations, closeDb, databaseUrl, migrate, openDatabase, resolveDatabasePath } from '../src/lib/db';

function refuseIfRemote(): void {
  const url = databaseUrl();
  if (url === ':memory:') return;
  if (!url.startsWith('file:')) {
    throw new Error(
      `Refusing to reset a non-file database (DATABASE_URL=${url}). ` +
        'This script only understands local SQLite files.',
    );
  }
  const path = resolveDatabasePath(url);
  if (!path.startsWith(process.cwd())) {
    throw new Error(`Refusing to reset a database outside the project (${path}).`);
  }
}

function main(): void {
  const url = databaseUrl();
  refuseIfRemote();

  // -wal and -shm sit beside the database; leaving them behind would let a
  // stale WAL be replayed into the fresh file.
  const path = resolveDatabasePath(url);
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${path}${suffix}`;
    if (existsSync(file)) {
      rmSync(file, { force: true });
      process.stdout.write(`  removed ${file}\n`);
    }
  }

  closeDb();
  const db = openDatabase(url);
  migrate(db);
  process.stdout.write(`  reset ${path}\n`);
  process.stdout.write(`  applied migrations: ${appliedMigrations(db).join(', ') || 'none'}\n`);
  db.close();
}

main();

import * as fs from 'fs';
import * as path from 'path';

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

import type { MigrationDb } from '../dbMigrations';

/** Minimal sqlite backend matching `MigrationDb` for running migrations in Node/jest. */
export async function openSqlJsMigrationDb(): Promise<{
  migrationDb: MigrationDb;
  sqlJsDb: SqlJsDatabase;
}> {
  const wasmPath = path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const raw = fs.readFileSync(wasmPath);
  const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const SQL = await initSqlJs({ wasmBinary });
  const sqlJsDb = new SQL.Database();

  const migrationDb: MigrationDb = {
    execAsync: async (source: string) => {
      sqlJsDb.exec(source);
    },

    runAsync: (async (source: string, params?: unknown) => {
      const stmt = sqlJsDb.prepare(source);
      try {
        const bindValues =
          params === undefined ? undefined : Array.isArray(params) ? params : undefined;
        if (bindValues !== undefined && bindValues.length > 0) {
          stmt.bind(bindValues as never);
        }
        stmt.step();
      } finally {
        stmt.free();
      }
      return {
        changes: sqlJsDb.getRowsModified(),
        lastInsertRowId: 0,
      };
    }) as MigrationDb['runAsync'],

    getFirstAsync: (async <T>(source: string, params?: unknown) => {
      const stmt = sqlJsDb.prepare(source);
      try {
        const bindValues =
          params === undefined ? undefined : Array.isArray(params) ? params : undefined;
        if (bindValues !== undefined && bindValues.length > 0) {
          stmt.bind(bindValues as never);
        }
        if (!stmt.step()) return null;
        return stmt.getAsObject() as T;
      } finally {
        stmt.free();
      }
    }) as MigrationDb['getFirstAsync'],

    getAllAsync: (async <T>(source: string, params?: unknown) => {
      const stmt = sqlJsDb.prepare(source);
      try {
        const bindValues =
          params === undefined ? undefined : Array.isArray(params) ? params : undefined;
        if (bindValues !== undefined && bindValues.length > 0) {
          stmt.bind(bindValues as never);
        }
        const rows: T[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as T);
        }
        return rows;
      } finally {
        stmt.free();
      }
    }) as MigrationDb['getAllAsync'],

    withTransactionAsync: async (task: () => Promise<void>) => {
      sqlJsDb.run('BEGIN IMMEDIATE;');
      try {
        await task();
        sqlJsDb.run('COMMIT;');
      } catch (e) {
        sqlJsDb.run('ROLLBACK;');
        throw e;
      }
    },
  };

  return { migrationDb, sqlJsDb };
}

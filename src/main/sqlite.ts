import fs from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

let sqlModule: SqlJsStatic | null = null;

async function getSql(appRoot: string): Promise<SqlJsStatic> {
  if (sqlModule) return sqlModule;
  sqlModule = await initSqlJs({
    locateFile: (file) => locateSqlJsFile(file, appRoot)
  });
  return sqlModule;
}

function locateSqlJsFile(file: string, appRoot: string): string {
  if (appRoot.endsWith('.asar')) return path.join(process.resourcesPath, file);
  return path.join(appRoot, 'node_modules', 'sql.js', 'dist', file);
}

export async function openReadonlyDatabase(filePath: string, appRoot: string): Promise<Database> {
  const SQL = await getSql(appRoot);
  const bytes = await fs.readFile(filePath);
  return new SQL.Database(new Uint8Array(bytes));
}

export function selectAll<T extends object>(db: Database, sql: string): T[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((row) => {
    const item: Record<string, unknown> = {};
    for (let index = 0; index < result.columns.length; index += 1) {
      item[result.columns[index]] = row[index];
    }
    return item as T;
  });
}
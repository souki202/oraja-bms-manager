import type { DirectoryNode, ExportPayload, TableChartRow, TableSummary } from './types';

export function buildTableExport(table: TableSummary, rows: TableChartRow[], outputDate = formatDate(new Date()), editorVersion = ''): ExportPayload {
  const tableRows = rows.filter((row) => row.tableId === table.id);
  const folderOrder = unique(tableRows.map((row) => row.level).filter(Boolean));
  const compatPrefix = commonCompatPrefix(folderOrder);
  const levelOrder = folderOrder.map((folder) => compatPrefix && folder.startsWith(compatPrefix) ? folder.slice(compatPrefix.length) : folder);

  return {
    header: {
      name: table.name,
      symbol: table.tag || '',
      level_order: levelOrder,
      folder_order: folderOrder,
      folder_sort_key: '',
      folder_sort_ascending: true,
      entry_type: '',
      data_url: table.url,
      compat_prefix: compatPrefix,
      last_update: outputDate,
      editor_name: 'beatoraja Manager',
      editor_version: editorVersion,
      output_date: outputDate
    },
    data: tableRows.map((row) => {
      const level = compatPrefix && row.level.startsWith(compatPrefix) ? row.level.slice(compatPrefix.length) : row.level;
      return {
        md5: row.md5 || '',
        sha256: row.sha256 || '',
        org_level: numericLevel(level),
        title: row.title,
        artist: row.artist,
        folder: row.level,
        level,
        lr2_bmsid: null,
        url: row.url1,
        url_diff: row.url2,
        name_diff: null,
        org_md5s: row.orgMd5 ? [row.orgMd5] : [],
        org_md5: row.orgMd5,
        comment: '',
        adddate: ''
      };
    })
  };
}

export function buildBmsPathExport(root: DirectoryNode, rows: TableChartRow[], outputDate = formatDate(new Date()), editorVersion = ''): ExportPayload {
  const rootRows = rows.filter((row) => isRowUnderRoot(row, root.path));
  const md5sByFolder = md5sGroupedByFolder(rootRows);

  return {
    header: {
      name: pathName(root.path || root.name),
      symbol: '',
      level_order: [],
      folder_order: [],
      folder_sort_key: '',
      folder_sort_ascending: true,
      entry_type: '',
      data_url: '',
      compat_prefix: '',
      last_update: outputDate,
      editor_name: 'beatoraja Manager',
      editor_version: editorVersion,
      output_date: outputDate
    },
    data: rootRows.map((row) => {
      const orgMd5s = row.orgMd5s?.length ? row.orgMd5s : md5sByFolder.get(folderKey(row.path || row.folder)) ?? [];
      return {
        md5: row.md5 || '',
        sha256: row.sha256 || '',
        org_level: row.songLevel ?? row.difficulty ?? null,
        title: row.title,
        artist: row.artist,
        folder: '',
        level: '',
        lr2_bmsid: null,
        url: '',
        url_diff: '',
        name_diff: null,
        org_md5s: orgMd5s,
        org_md5: orgMd5s[0] ?? row.orgMd5,
        comment: '',
        adddate: formatUnixDate(row.addDate)
      };
    })
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function numericLevel(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function commonCompatPrefix(folders: string[]): string {
  if (folders.length === 0) return '';
  if (folders.every((folder) => /^LEVEL\s+/.test(folder))) return 'LEVEL ';
  return '';
}

function md5sGroupedByFolder(rows: TableChartRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = folderKey(row.path || row.folder);
    if (!key || !row.md5) continue;
    const md5s = map.get(key) ?? [];
    md5s.push(row.md5);
    map.set(key, md5s);
  }
  return map;
}

function isRowUnderRoot(row: TableChartRow, root: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  const candidates = [row.path, row.folder].map(normalizePath).filter(Boolean);
  return candidates.some((candidate) => candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`));
}

function folderKey(filePath: string): string {
  const normalized = normalizePath(filePath);
  const separator = normalized.lastIndexOf('/');
  return separator >= 0 ? normalized.slice(0, separator) : normalized;
}

function pathName(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatUnixDate(value: number | null | undefined): string {
  if (!value) return '';
  return formatDate(new Date(value * 1000));
}

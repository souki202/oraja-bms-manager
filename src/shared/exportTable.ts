import type { ExportPayload, TableChartRow, TableSummary } from './types';

export function buildTableExport(table: TableSummary, rows: TableChartRow[], outputDate = formatDate(new Date())): ExportPayload {
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
      last_update: '',
      editor_name: 'beatoraja Manager',
      editor_version: '',
      output_date: outputDate
    },
    data: tableRows.map((row) => {
      const level = compatPrefix && row.level.startsWith(compatPrefix) ? row.level.slice(compatPrefix.length) : row.level;
      return {
        md5: row.md5 || '',
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

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}
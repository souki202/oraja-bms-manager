import { useMemo, useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, ExternalLink, FolderOpen, GitBranch, RefreshCw, Search, Settings } from 'lucide-react';
import type { DirectoryNode, ManagerState, TableChartRow } from '../shared/types';
import { findSimilarRows, rowMatchesSearch, statusClass } from '../shared/domain';

type ContextMenuState = {
  x: number;
  y: number;
  row: TableChartRow;
} | null;

type SortKey = 'level' | 'songLevel' | 'title' | 'artist' | 'url1' | 'url2' | 'status' | 'notes' | 'tableName' | 'path';
type SortDirection = 'asc' | 'desc';
type SortState = { key: SortKey; direction: SortDirection };

const defaultSort: SortState = { key: 'title', direction: 'asc' };
const statusOrder = new Map<string, number>([
  ['NO SONG', 0],
  ['NO PLAY', 1],
  ['FAILED', 2],
  ['ASSIST CLEAR', 3],
  ['EASY CLEAR', 4],
  ['CLEAR', 5],
  ['HARD CLEAR', 6],
  ['EX HARD CLEAR', 7],
  ['FULL COMBO', 8]
]);

export function App(): JSX.Element {
  const [state, setState] = useState<ManagerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedBmsRoot, setSelectedBmsRoot] = useState<DirectoryNode | null>(null);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [similarTarget, setSimilarTarget] = useState<TableChartRow | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    const next = await window.managerApi.loadState();
    setState(next);
    setSearchText(next.settings.searchText ?? '');
    setSelectedTableId(next.settings.selectedTableId ?? next.tables[0]?.id ?? null);
    setSelectedBmsRoot(null);
    setLoading(false);
  }

  async function saveSettings(patch: Parameters<typeof window.managerApi.saveSettings>[0]): Promise<void> {
    const next = await window.managerApi.saveSettings(patch);
    setState(next);
  }

  const visibleRows = useMemo(() => {
    const sourceRows = selectedBmsRoot
      ? (state?.libraryRows ?? []).filter((row) => isRowUnderRoot(row, selectedBmsRoot.path))
      : state?.rows ?? [];

    const filteredRows = sourceRows.filter((row) => {
      const tableOk = selectedBmsRoot || !selectedTableId ? true : row.tableId === selectedTableId;
      return tableOk && rowMatchesSearch(row, searchText);
    });

    return sortRows(filteredRows, sort);
  }, [state, selectedTableId, selectedBmsRoot, searchText, sort]);

  const similarRows = useMemo(() => {
    if (!state || !similarTarget) return [];
    return sortRows(findSimilarRows(similarTarget, state.rows), sort);
  }, [state, similarTarget, sort]);

  const activeTable = !selectedBmsRoot ? state?.tables.find((table) => table.id === selectedTableId) ?? null : null;

  async function chooseRoot(): Promise<void> {
    const root = await window.managerApi.chooseRoot();
    if (root) await saveSettings({ beatorajaRoot: root });
  }

  async function selectPlayer(playerId: string): Promise<void> {
    await saveSettings({ selectedPlayerId: playerId });
  }

  async function selectTable(tableId: string | null): Promise<void> {
    setSelectedBmsRoot(null);
    setSelectedTableId(tableId);
    await saveSettings({ selectedTableId: tableId });
  }

  function selectBmsRoot(node: DirectoryNode): void {
    setSelectedBmsRoot(node);
    setSelectedTableId(null);
  }

  async function updateSearch(value: string): Promise<void> {
    setSearchText(value);
    await saveSettings({ searchText: value });
  }

  function toggleSort(key: SortKey): void {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function openContextMenu(event: React.MouseEvent, row: TableChartRow): void {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, row });
  }

  if (loading || !state) {
    return <div className="boot">Loading...</div>;
  }

  return (
    <div className="app" onClick={() => setContextMenu(null)}>
      <header className="topbar">
        <div className="brand">beatoraja Manager</div>
        <button className="icon-text" onClick={chooseRoot} title="beatoraja directory">
          <Settings size={16} />
          <span>{state.beatoraja?.root ?? 'Select beatoraja'}</span>
        </button>
        <select value={state.selectedPlayer?.id ?? ''} onChange={(event) => void selectPlayer(event.target.value)}>
          {state.players.map((player) => <option key={player.id} value={player.id}>{player.name} ({player.id})</option>)}
        </select>
        <button className="icon-button" onClick={() => void load()} title="Reload">
          <RefreshCw size={16} />
        </button>
        <div className="topbar-counts">
          <span>{state.tables.length} tables</span>
          <span>{visibleRows.length} charts</span>
        </div>
      </header>

      {state.diagnostics.length > 0 && (
        <div className="diagnostics">{state.diagnostics.join(' / ')}</div>
      )}

      <div className="workspace">
        <aside className="sidebar">
          <section className="panel sidebar-section table-section">
            <div className="panel-title">Tables</div>
            <button className={`tree-row ${!selectedBmsRoot && selectedTableId === null ? 'selected' : ''}`} onClick={() => void selectTable(null)}>
              <span>All Tables</span>
              <small>{state.rows.length}</small>
            </button>
            <div className="table-list">
              {state.tables.map((table) => (
                <button key={table.id} className={`tree-row ${!selectedBmsRoot && table.id === selectedTableId ? 'selected' : ''}`} onClick={() => void selectTable(table.id)} title={table.name}>
                  <span>{table.name}</span>
                  <small>{table.chartCount} / {table.missingCount}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel sidebar-section roots-section">
            <div className="panel-title">BMS Path</div>
            <div className="roots-list">
              {state.bmsRootNodes.map((node) => (
                <button key={node.id} className={`tree-row path-row ${selectedBmsRoot?.path === node.path ? 'selected' : ''}`} onClick={() => selectBmsRoot(node)} title={node.path}>
                  <FolderOpen size={14} />
                  <span>{node.name}</span>
                  <small>{node.chartCount ?? 0}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="mainpane">
          <div className="toolbar">
            <div className="title-block">
              <strong>{selectedBmsRoot?.name ?? activeTable?.name ?? 'All Tables'}</strong>
              <span>{makeSubtitle(selectedBmsRoot, activeTable, visibleRows.length)}</span>
            </div>
            <label className="searchbox">
              <Search size={16} />
              <input value={searchText} onChange={(event) => void updateSearch(event.target.value)} placeholder="Search title / artist / hash / table" />
            </label>
          </div>

          <ChartTable rows={visibleRows} sort={sort} onSort={toggleSort} onContextMenu={openContextMenu} />
        </main>

        {similarTarget && (
          <aside className="similar-pane">
            <div className="panel-title with-close">
              <span>Same Song</span>
              <button onClick={() => setSimilarTarget(null)}>Close</button>
            </div>
            <div className="similar-target">{similarTarget.title}</div>
            <ChartTable rows={similarRows} compact sort={sort} onSort={toggleSort} onContextMenu={openContextMenu} />
          </aside>
        )}
      </div>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button disabled={!contextMenu.row.url1} onClick={() => void window.managerApi.openExternal(contextMenu.row.url1)}><ExternalLink size={14} />Open URL1</button>
          <button disabled={!contextMenu.row.url2} onClick={() => void window.managerApi.openExternal(contextMenu.row.url2)}><ExternalLink size={14} />Open URL2</button>
          <button disabled={!contextMenu.row.path && !contextMenu.row.folder} onClick={() => void window.managerApi.openPath({ path: contextMenu.row.path, folder: contextMenu.row.folder })}><FolderOpen size={14} />Open in Explorer</button>
          <button onClick={() => { void navigator.clipboard.writeText(contextMenu.row.sha256 || contextMenu.row.md5); setContextMenu(null); }}><Copy size={14} />Copy Hash</button>
          <button onClick={() => { setSimilarTarget(contextMenu.row); setContextMenu(null); }}><GitBranch size={14} />Same Song Search</button>
        </div>
      )}
    </div>
  );
}

function ChartTable({ rows, compact = false, sort, onSort, onContextMenu }: { rows: TableChartRow[]; compact?: boolean; sort: SortState; onSort(key: SortKey): void; onContextMenu(event: React.MouseEvent, row: TableChartRow): void }): JSX.Element {
  const columns: Array<{ key: SortKey; label: string; hidden?: boolean }> = [
    { key: 'level', label: 'FOLDER' },
    { key: 'songLevel', label: 'LEVEL' },
    { key: 'title', label: 'TITLE' },
    { key: 'artist', label: 'ARTIST' },
    { key: 'url1', label: 'URL1' },
    { key: 'url2', label: 'URL2' },
    { key: 'status', label: 'CLEAR' },
    { key: 'notes', label: 'NOTES' },
    { key: 'tableName', label: 'TABLE', hidden: compact },
    { key: 'path', label: 'PATH', hidden: compact }
  ];

  return (
    <div className={`chart-table-wrap ${compact ? 'compact' : ''}`}>
      <table className="chart-table">
        <thead>
          <tr>
            {columns.filter((column) => !column.hidden).map((column) => (
              <th key={column.key}>
                <button className="sort-header" onClick={() => onSort(column.key)}>
                  <span>{column.label}</span>
                  <SortIcon active={sort.key === column.key} direction={sort.direction} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.status === 'NO SONG' ? 'no-song-row' : ''} onContextMenu={(event) => onContextMenu(event, row)}>
              <td className="folder-cell" title={row.level}>{row.level}</td>
              <td>{row.songLevel ?? row.difficulty ?? ''}</td>
              <td className="title-cell" title={`${row.title} ${row.subtitle}`}>{row.title}<span>{row.subtitle}</span></td>
              <td title={row.artist}>{row.artist}</td>
              <td><UrlButton url={row.url1} /></td>
              <td><UrlButton url={row.url2} /></td>
              <td><span className={`lamp ${statusClass(row.status)}`}>{row.status}</span></td>
              <td>{row.notes ?? ''}</td>
              {!compact && <td title={row.tableName}>{row.tableName}</td>}
              {!compact && <td className="path-cell" title={row.path || row.folder}>{row.path || row.folder}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }): JSX.Element {
  if (!active) return <ArrowUpDown size={12} />;
  return direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function UrlButton({ url }: { url: string }): JSX.Element {
  return (
    <button className="url-button" disabled={!url} onClick={() => void window.managerApi.openExternal(url)} title={url || 'No URL'}>
      <ExternalLink size={14} />
    </button>
  );
}

function makeSubtitle(selectedBmsRoot: DirectoryNode | null, activeTable: { chartCount: number; missingCount: number } | null, visibleCount: number): string {
  if (selectedBmsRoot) return `${visibleCount} charts under selected BMS Path`;
  if (activeTable) return `${activeTable.chartCount} charts / ${activeTable.missingCount} NO SONG`;
  return `${visibleCount} charts`;
}

function sortRows(rows: TableChartRow[], sort: SortState): TableChartRow[] {
  return [...rows].sort((a, b) => {
    const direction = sort.direction === 'asc' ? 1 : -1;
    return compareValues(sortValue(a, sort.key), sortValue(b, sort.key)) * direction;
  });
}

function sortValue(row: TableChartRow, key: SortKey): string | number {
  if (key === 'songLevel') return row.songLevel ?? row.difficulty ?? -1;
  if (key === 'status') return statusOrder.get(row.status) ?? -1;
  if (key === 'notes') return row.notes ?? -1;
  return String(row[key] ?? '').toLowerCase();
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja', { numeric: true, sensitivity: 'base' });
}

function isRowUnderRoot(row: TableChartRow, root: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  const candidates = [row.path, row.folder].map(normalizePath).filter(Boolean);
  return candidates.some((candidate) => candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}
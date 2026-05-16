import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Copy, Download, ExternalLink, Filter, FolderOpen, GitBranch, RefreshCw, Search, Settings, X } from 'lucide-react';
import type { DirectoryNode, ManagerState, TableChartRow, TableSummary } from '../shared/types';
import type { ChartColumnFilter, ChartColumnFilters, ChartFilterCache, ChartFilterKey, UrlFilterMode } from '../shared/chartFilters';
import { clearStatuses, countActiveColumnFilters, isColumnFilterActive, matchesChartFilters, normalizeSearchQuery, prepareColumnFilters } from '../shared/chartFilters';
import { buildSimilarSearchRows, findSimilarRows, statusClass } from '../shared/domain';
import { buildTableExport } from '../shared/exportTable';
import { buildRowsAsync } from './asyncRows';
import { positionContextMenu, positionFilterMenu } from './menuPosition';
import type { MenuSide } from './menuPosition';

type ContextMenuState = {
  x: number;
  y: number;
  submenuSide: MenuSide;
  row: TableChartRow;
} | null;

type SortKey = 'level' | 'songLevel' | 'title' | 'artist' | 'url1' | 'url2' | 'status' | 'notes' | 'tableName' | 'path';
type SortDirection = 'asc' | 'desc';
type SortState = { key: SortKey; direction: SortDirection };
type IrTarget = 'lr2' | 'mocha' | 'minir';
type TableColumn = { key: SortKey; label: string; width: number; minWidth: number };
type FilterMenuState = { key: SortKey; x: number; y: number } | null;

const defaultSort: SortState = { key: 'title', direction: 'asc' };
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const chartColumns: TableColumn[] = [
  { key: 'level', label: 'FOLDER', width: 120, minWidth: 86 },
  { key: 'songLevel', label: 'LEVEL', width: 62, minWidth: 54 },
  { key: 'title', label: 'TITLE', width: 300, minWidth: 190 },
  { key: 'artist', label: 'ARTIST', width: 230, minWidth: 160 },
  { key: 'url1', label: 'URL1', width: 52, minWidth: 46 },
  { key: 'url2', label: 'URL2', width: 52, minWidth: 46 },
  { key: 'status', label: 'CLEAR', width: 120, minWidth: 104 },
  { key: 'notes', label: 'NOTES', width: 78, minWidth: 66 },
  { key: 'tableName', label: 'TABLE', width: 180, minWidth: 130 },
  { key: 'path', label: 'PATH', width: 520, minWidth: 360 }
];
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
  const [filteredRows, setFilteredRows] = useState<TableChartRow[]>([]);
  const [isListLoading, setIsListLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [filterMenu, setFilterMenu] = useState<FilterMenuState>(null);
  const [columnFilters, setColumnFilters] = useState<ChartColumnFilters>({});
  const [similarTarget, setSimilarTarget] = useState<TableChartRow | null>(null);

  const rowFilterCache = useMemo<ChartFilterCache>(() => new WeakMap(), [state]);
  const preparedColumnFilters = useMemo(() => prepareColumnFilters(columnFilters), [columnFilters]);
  const activeFilterCount = useMemo(() => countActiveColumnFilters(columnFilters), [columnFilters]);

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    const next = await window.managerApi.loadState();
    const sortedTables = sortTables(next.tables);
    setState(next);
    setSearchText(next.settings.searchText ?? '');
    setSelectedTableId(next.settings.selectedTableId ?? sortedTables[0]?.id ?? null);
    setSelectedBmsRoot(null);
    setLoading(false);
  }

  async function saveSettings(patch: Parameters<typeof window.managerApi.saveSettings>[0]): Promise<void> {
    const next = await window.managerApi.saveSettings(patch);
    setState(next);
  }

  const sortedTables = useMemo(() => sortTables(state?.tables ?? []), [state]);

  useEffect(() => {
    if (!state) return undefined;

    const controller = new AbortController();
    setIsListLoading(true);
    const sourceRows = selectedBmsRoot ? state.libraryRows : state.rows;
    const normalizedSearch = normalizeSearchQuery(searchText);

    void buildRowsAsync(
      sourceRows,
      (row) => {
        const tableOk = selectedBmsRoot || !selectedTableId ? true : row.tableId === selectedTableId;
        const pathOk = selectedBmsRoot ? isRowUnderRoot(row, selectedBmsRoot.path) : true;
        return tableOk && pathOk && matchesChartFilters(row, normalizedSearch, preparedColumnFilters, rowFilterCache);
      },
      controller.signal
    ).then((rows) => {
      if (!controller.signal.aborted) setFilteredRows(rows);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error(error);
    }).finally(() => {
      if (!controller.signal.aborted) setIsListLoading(false);
    });

    return () => {
      controller.abort();
      setIsListLoading(true);
    };
  }, [state, selectedTableId, selectedBmsRoot, searchText, preparedColumnFilters, rowFilterCache]);

  const visibleRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  const similarRows = useMemo(() => {
    if (!state || !similarTarget) return [];
    return sortRows(findSimilarRows(similarTarget, buildSimilarSearchRows(state.rows, state.libraryRows, similarTarget)), sort);
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
  }

  function selectBmsRoot(node: DirectoryNode): void {
    setSelectedBmsRoot(node);
    setSelectedTableId(null);
  }

  async function updateSearch(value: string): Promise<void> {
    setSearchText(value);
  }

  async function exportActiveTable(): Promise<void> {
    if (!activeTable || !state) return;
    setExportMessage('Exporting...');
    const payload = buildTableExport(activeTable, state.rows);
    const result = await window.managerApi.exportTable(payload);
    setExportMessage(result.canceled ? 'Export canceled' : `Exported: ${result.directory}`);
  }

  function toggleSort(key: SortKey): void {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function openFilterMenu(event: React.MouseEvent, key: SortKey): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu(null);
    setFilterMenu({ key, ...positionFilterMenu(rect, currentViewport()) });
  }

  function updateColumnFilter(key: SortKey, patch: ChartColumnFilter): void {
    setColumnFilters((current) => {
      const nextFilter = { ...emptyColumnFilter(), ...current[key], ...patch };
      if (!isColumnFilterActive(key as ChartFilterKey, nextFilter)) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: nextFilter };
    });
  }

  function clearColumnFilter(key: SortKey): void {
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function openContextMenu(event: React.MouseEvent, row: TableChartRow): void {
    event.preventDefault();
    event.stopPropagation();
    setFilterMenu(null);
    setContextMenu({
      ...positionContextMenu({ x: event.clientX, y: event.clientY }, currentViewport()),
      row
    });
  }

  function openExternalFromMenu(url: string): void {
    if (url) void window.managerApi.openExternal(url);
    setContextMenu(null);
  }

  function openIrFromMenu(row: TableChartRow, target: IrTarget): void {
    const url = buildIrUrl(row, target);
    if (url) void window.managerApi.openExternal(url);
    setContextMenu(null);
  }

  function openPathFromMenu(row: TableChartRow): void {
    void window.managerApi.openPath({ path: row.path, folder: row.folder });
    setContextMenu(null);
  }

  if (loading || !state) {
    return <div className="boot">読み込み中...</div>;
  }

  return (
    <div className="app" onClick={() => { setContextMenu(null); setFilterMenu(null); }}>
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
          <span>{isListLoading ? 'loading...' : `${visibleRows.length} charts`}</span>
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
              {sortedTables.map((table) => (
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
            {activeFilterCount > 0 && (
              <button className="icon-text clear-filters" onClick={() => setColumnFilters({})} title="Clear column filters">
                <X size={16} />
                <span>{activeFilterCount} filters</span>
              </button>
            )}
            <button className="icon-text export-button" disabled={!activeTable} onClick={() => void exportActiveTable()} title="Export selected table">
              <Download size={16} />
              <span>Export</span>
            </button>
          </div>
          {exportMessage && <div className="export-message">{exportMessage}</div>}

          <div className="list-region">
            <ChartTable rows={visibleRows} sort={sort} columnFilters={columnFilters} onSort={toggleSort} onFilterClick={openFilterMenu} onContextMenu={openContextMenu} />
            {isListLoading && <div className="loading-overlay">読み込み中...</div>}
          </div>
        </main>

        {similarTarget && (
          <aside className="similar-pane">
            <div className="panel-title with-close">
              <span>Same Song</span>
              <button onClick={() => setSimilarTarget(null)}>Close</button>
            </div>
            <div className="similar-target">{similarTarget.title}</div>
            <ChartTable rows={similarRows} compact sort={sort} columnFilters={columnFilters} onSort={toggleSort} onFilterClick={openFilterMenu} onContextMenu={openContextMenu} />
          </aside>
        )}
      </div>

      {filterMenu && (
        <ColumnFilterMenu
          column={chartColumns.find((column) => column.key === filterMenu.key) ?? chartColumns[0]}
          filter={columnFilters[filterMenu.key] ?? emptyColumnFilter()}
          x={filterMenu.x}
          y={filterMenu.y}
          onChange={(patch) => updateColumnFilter(filterMenu.key, patch)}
          onClear={() => clearColumnFilter(filterMenu.key)}
        />
      )}

      {contextMenu && (
        <div className={`context-menu submenu-${contextMenu.submenuSide}`} style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button disabled={!contextMenu.row.url1} onClick={() => openExternalFromMenu(contextMenu.row.url1)}><ExternalLink size={14} />Open URL1</button>
          <button disabled={!contextMenu.row.url2} onClick={() => openExternalFromMenu(contextMenu.row.url2)}><ExternalLink size={14} />Open URL2</button>
          <button disabled={!contextMenu.row.path && !contextMenu.row.folder} onClick={() => openPathFromMenu(contextMenu.row)}><FolderOpen size={14} />Open in Explorer</button>
          <div className="context-submenu">
            <button disabled={!contextMenu.row.md5 && !contextMenu.row.sha256}><ExternalLink size={14} /><span>Open IR</span><ChevronRight size={14} /></button>
            <div className="context-submenu-panel">
              <button disabled={!contextMenu.row.md5} onClick={() => openIrFromMenu(contextMenu.row, 'lr2')}>LR2</button>
              <button disabled={!contextMenu.row.sha256} onClick={() => openIrFromMenu(contextMenu.row, 'mocha')}>mocha-repository</button>
              <button disabled={!contextMenu.row.sha256} onClick={() => openIrFromMenu(contextMenu.row, 'minir')}>MinIR</button>
            </div>
          </div>
          <button onClick={() => { void navigator.clipboard.writeText(contextMenu.row.sha256 || contextMenu.row.md5); setContextMenu(null); }}><Copy size={14} />Copy Hash</button>
          <button onClick={() => { setSimilarTarget(contextMenu.row); setContextMenu(null); }}><GitBranch size={14} />Same Song Search</button>
        </div>
      )}
    </div>
  );
}

function currentViewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function ChartTable({ rows, compact = false, sort, columnFilters, onSort, onFilterClick, onContextMenu }: { rows: TableChartRow[]; compact?: boolean; sort: SortState; columnFilters: ChartColumnFilters; onSort(key: SortKey): void; onFilterClick(event: React.MouseEvent, key: SortKey): void; onContextMenu(event: React.MouseEvent, row: TableChartRow): void }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<Record<SortKey, number>>(() => createColumnWidthState());
  const visibleColumns = chartColumns.filter((column) => !(compact && (column.key === 'tableName' || column.key === 'path')));
  const tableWidth = visibleColumns.reduce((sum, column) => sum + columnWidths[column.key], 0);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 23,
    overscan: 20
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  function startColumnResize(event: React.PointerEvent<HTMLSpanElement>, column: TableColumn): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column.key];

    const resize = (moveEvent: PointerEvent): void => {
      const nextWidth = Math.max(column.minWidth, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    };
    const stopResize = (): void => {
      window.removeEventListener('pointermove', resize);
      document.body.classList.remove('resizing-column');
    };

    document.body.classList.add('resizing-column');
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize, { once: true });
  }

  return (
    <div ref={parentRef} className={`chart-table-wrap ${compact ? 'compact' : ''}`}>
      <table className="chart-table" style={{ width: tableWidth, minWidth: tableWidth }}>
        <colgroup>
          {visibleColumns.map((column) => <col key={column.key} style={{ width: columnWidths[column.key] }} />)}
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th key={column.key}>
                <div className="header-controls">
                  <button className="sort-header" onClick={() => onSort(column.key)}>
                    <span>{column.label}</span>
                    <SortIcon active={sort.key === column.key} direction={sort.direction} />
                  </button>
                  <button className={`filter-button ${isColumnFilterActive(column.key as ChartFilterKey, columnFilters[column.key]) ? 'active' : ''}`} onClick={(event) => onFilterClick(event, column.key)} title={`${column.label} filter`}>
                    <Filter size={12} />
                  </button>
                </div>
                <span className="column-resizer" onPointerDown={(event) => startColumnResize(event, column)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && <VirtualSpacer height={paddingTop} colSpan={visibleColumns.length} />}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
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
            );
          })}
          {paddingBottom > 0 && <VirtualSpacer height={paddingBottom} colSpan={visibleColumns.length} />}
        </tbody>
      </table>
    </div>
  );
}

function ColumnFilterMenu({ column, filter, x, y, onChange, onClear }: { column: TableColumn; filter: ChartColumnFilter; x: number; y: number; onChange(patch: ChartColumnFilter): void; onClear(): void }): JSX.Element {
  return (
    <div className="filter-menu" style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}>
      <div className="filter-menu-title">
        <span>{column.label}</span>
      </div>
      <ColumnFilterFields columnKey={column.key} filter={filter} onChange={onChange} onClear={onClear} />
    </div>
  );
}

function ColumnFilterFields({ columnKey, filter, onChange, onClear }: { columnKey: SortKey; filter: ChartColumnFilter; onChange(patch: ChartColumnFilter): void; onClear(): void }): JSX.Element {
  if (columnKey === 'songLevel' || columnKey === 'notes') {
    return (
      <div className="filter-input-line">
        <div className="filter-field-row numeric-filter">
          <label>
            <span>Min</span>
            <input type="number" value={filter.min ?? ''} onChange={(event) => onChange({ min: event.target.value })} />
          </label>
          <label>
            <span>Max</span>
            <input type="number" value={filter.max ?? ''} onChange={(event) => onChange({ max: event.target.value })} />
          </label>
        </div>
        <button className="filter-clear-button" onClick={onClear} title="Clear filter"><X size={14} /></button>
      </div>
    );
  }

  if (columnKey === 'status') {
    const selected = new Set(filter.statuses ?? []);
    return (
      <div className="status-filter-list">
        {clearStatuses.map((status) => (
          <label key={status}>
            <input
              type="checkbox"
              checked={selected.has(status)}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(status)) next.delete(status);
                else next.add(status);
                onChange({ statuses: [...next] });
              }}
            />
            <span className={`lamp ${statusClass(status)}`}>{status}</span>
          </label>
        ))}
        <button className="status-clear-button" onClick={onClear}>Clear</button>
      </div>
    );
  }

  if (columnKey === 'url1' || columnKey === 'url2') {
    return (
      <>
        <label className="filter-field">
          <span>URL</span>
          <select value={filter.urlMode ?? 'all'} onChange={(event) => onChange({ urlMode: event.target.value as UrlFilterMode })}>
            <option value="all">All</option>
            <option value="has">Has URL</option>
            <option value="none">No URL</option>
          </select>
        </label>
        <TextFilterInput value={filter.text ?? ''} onChange={(value) => onChange({ text: value })} onClear={onClear} />
      </>
    );
  }

  return <TextFilterInput value={filter.text ?? ''} onChange={(value) => onChange({ text: value })} onClear={onClear} />;
}

function TextFilterInput({ value, onChange, onClear }: { value: string; onChange(value: string): void; onClear(): void }): JSX.Element {
  return (
    <div className="filter-input-line">
      <label className="filter-field">
        <span>Contains</span>
        <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
      <button className="filter-clear-button" onClick={onClear} title="Clear filter"><X size={14} /></button>
    </div>
  );
}

function VirtualSpacer({ height, colSpan }: { height: number; colSpan: number }): JSX.Element {
  return (
    <tr className="virtual-spacer" aria-hidden="true">
      <td colSpan={colSpan} style={{ height }} />
    </tr>
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

function createColumnWidthState(): Record<SortKey, number> {
  return chartColumns.reduce<Record<SortKey, number>>((widths, column) => {
    widths[column.key] = column.width;
    return widths;
  }, {
    level: 0,
    songLevel: 0,
    title: 0,
    artist: 0,
    url1: 0,
    url2: 0,
    status: 0,
    notes: 0,
    tableName: 0,
    path: 0
  });
}

function emptyColumnFilter(): ChartColumnFilter {
  return { text: '', min: '', max: '', statuses: [], urlMode: 'all' };
}

function buildIrUrl(row: TableChartRow, target: IrTarget): string {
  const hash = (target === 'lr2' ? row.md5 : row.sha256).trim().toLowerCase();
  if (!hash) return '';
  if (target === 'lr2') return `http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?mode=ranking&bmsmd5=${hash}`;
  if (target === 'mocha') return `https://mocha-repository.info/song.php?sha256=${hash}`;
  return `https://www.gaftalk.com/minir/#/viewer/song/${hash}/0`;
}

function makeSubtitle(selectedBmsRoot: DirectoryNode | null, activeTable: { chartCount: number; missingCount: number } | null, visibleCount: number): string {
  if (selectedBmsRoot) return `${visibleCount} charts under selected BMS Path`;
  if (activeTable) return `${activeTable.chartCount} charts / ${activeTable.missingCount} NO SONG`;
  return `${visibleCount} charts`;
}

function sortTables(tables: TableSummary[]): TableSummary[] {
  return [...tables].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }));
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
  return collator.compare(String(a), String(b));
}

function isRowUnderRoot(row: TableChartRow, root: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '');
  const candidates = [row.path, row.folder].map(normalizePath).filter(Boolean);
  return candidates.some((candidate) => candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

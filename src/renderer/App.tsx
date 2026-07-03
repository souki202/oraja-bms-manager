import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, AudioLines, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Filter, FolderOpen, GitBranch, RefreshCw, Search, Settings, Trash2, Upload, X } from 'lucide-react';
import type { AudioFolder, BgaFolder, ChartImportAnalysis, DirectoryNode, DuplicateChartGroup, ImportCandidate, ManagerState, TableChartRow, TableSummary } from '../shared/types';
import type { ChartColumnFilter, ChartColumnFilters, ChartFilterCache, ChartFilterKey, UrlFilterMode } from '../shared/chartFilters';
import { clearStatuses, countActiveColumnFilters, isColumnFilterActive, matchesChartFilters, normalizeSearchQuery, prepareColumnFilters } from '../shared/chartFilters';
import { countRedundantChartCopies, findDuplicateChartGroups } from '../shared/duplicateCharts';
import { buildSimilarSearchRows, findSimilarRows, statusClass } from '../shared/domain';
import { buildBmsPathExport, buildTableExport } from '../shared/exportTable';
import { bokutachiGameForMode, buildStaticIrUrl, canOpenBokutachi, hasAnyIrTarget } from '../shared/ir';
import type { IrTarget } from '../shared/ir';
import { buildRowsAsync } from './asyncRows';
import { positionContextMenu, positionFilterMenu } from './menuPosition';
import type { MenuSide } from './menuPosition';
import packageJson from '../../package.json';

type ContextMenuState = {
  x: number;
  y: number;
  submenuSide: MenuSide;
  row: TableChartRow;
} | null;

type SortKey = 'level' | 'songLevel' | 'title' | 'artist' | 'url1' | 'url2' | 'status' | 'notes' | 'tableName' | 'path';
type SortDirection = 'asc' | 'desc';
type SortState = { key: SortKey; direction: SortDirection };
type TableColumn = { key: SortKey; label: string; width: number; minWidth: number };
type FilterMenuState = { key: SortKey; x: number; y: number } | null;
type ActiveView = 'charts' | 'duplicates' | 'audio' | 'bga';

const defaultSort: SortState = { key: 'title', direction: 'asc' };
const editorVersion = String(packageJson.version ?? '');
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
  const [activeView, setActiveView] = useState<ActiveView>('charts');
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
  const [toastMessage, setToastMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [importAnalysis, setImportAnalysis] = useState<ChartImportAnalysis | null>(null);
  const [selectedImportCandidateId, setSelectedImportCandidateId] = useState('');
  const [isImportBusy, setIsImportBusy] = useState(false);
  const [importBusyMessage, setImportBusyMessage] = useState('');
  const [mergeBusyGroupId, setMergeBusyGroupId] = useState('');
  const [mergeBusyMessage, setMergeBusyMessage] = useState('');
  const [isAudioConversionBusy, setIsAudioConversionBusy] = useState(false);
  const [mergedDuplicateGroupIds, setMergedDuplicateGroupIds] = useState<Set<string>>(new Set());
  const toastTimeoutRef = useRef<number | null>(null);

  const rowFilterCache = useMemo<ChartFilterCache>(() => new WeakMap(), [state]);
  const preparedColumnFilters = useMemo(() => prepareColumnFilters(columnFilters), [columnFilters]);
  const activeFilterCount = useMemo(() => countActiveColumnFilters(columnFilters), [columnFilters]);
  const duplicateGroups = useMemo(
    () => findDuplicateChartGroups(state?.libraryRows ?? []).filter((group) => !mergedDuplicateGroupIds.has(group.id)),
    [state, mergedDuplicateGroupIds]
  );
  const visibleDuplicateGroups = useMemo(() => filterDuplicateGroups(duplicateGroups, searchText), [duplicateGroups, searchText]);
  const redundantCopyCount = useMemo(() => countRedundantChartCopies(duplicateGroups), [duplicateGroups]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedImportCandidateId(importAnalysis?.candidates[0]?.id ?? '');
  }, [importAnalysis]);

  async function load(): Promise<void> {
    setLoading(true);
    const next = await window.managerApi.loadState();
    const sortedTables = sortTables(next.tables);
    setState(next);
    setSearchText(next.settings.searchText ?? '');
    setActiveView('charts');
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
    if (activeView !== 'charts') {
      setFilteredRows([]);
      setIsListLoading(false);
      return undefined;
    }

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
  }, [state, activeView, selectedTableId, selectedBmsRoot, searchText, preparedColumnFilters, rowFilterCache]);

  const visibleRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  const similarRows = useMemo(() => {
    if (!state || !similarTarget) return [];
    return sortRows(findSimilarRows(similarTarget, buildSimilarSearchRows(state.rows, state.libraryRows, similarTarget)), sort);
  }, [state, similarTarget, sort]);

  const activeTable = activeView === 'charts' && !selectedBmsRoot ? state?.tables.find((table) => table.id === selectedTableId) ?? null : null;

  async function chooseRoot(): Promise<void> {
    if (isAudioConversionBusy) return;
    const root = await window.managerApi.chooseRoot();
    if (root) await saveSettings({ beatorajaRoot: root });
  }

  async function selectPlayer(playerId: string): Promise<void> {
    if (isAudioConversionBusy) return;
    await saveSettings({ selectedPlayerId: playerId });
  }

  async function selectTable(tableId: string | null): Promise<void> {
    if (isAudioConversionBusy) return;
    setActiveView('charts');
    setSelectedBmsRoot(null);
    setSelectedTableId(tableId);
  }

  function selectBmsRoot(node: DirectoryNode): void {
    if (isAudioConversionBusy) return;
    setActiveView('charts');
    setSelectedBmsRoot(node);
    setSelectedTableId(null);
  }

  function selectDuplicates(): void {
    if (isAudioConversionBusy) return;
    setActiveView('duplicates');
    setSelectedBmsRoot(null);
    setSelectedTableId(null);
    setSimilarTarget(null);
    setColumnFilters({});
  }

  function selectAudioConversion(): void {
    if (isAudioConversionBusy) return;
    setActiveView('audio');
    setSelectedBmsRoot(null);
    setSelectedTableId(null);
    setSimilarTarget(null);
    setColumnFilters({});
  }

  function selectBgaCleanup(): void {
    if (isAudioConversionBusy) return;
    setActiveView('bga');
    setSelectedBmsRoot(null);
    setSelectedTableId(null);
    setSimilarTarget(null);
    setColumnFilters({});
  }

  async function updateSearch(value: string): Promise<void> {
    setSearchText(value);
  }

  async function exportActiveSelection(): Promise<void> {
    if ((!activeTable && !selectedBmsRoot) || !state) return;
    setExportMessage('Exporting...');
    const payload = activeTable
      ? buildTableExport(activeTable, state.rows, undefined, editorVersion)
      : buildBmsPathExport(selectedBmsRoot!, state.libraryRows, undefined, editorVersion);
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

  async function openIrFromMenu(row: TableChartRow, target: IrTarget): Promise<void> {
    setContextMenu(null);
    const url = target === 'bokutachi' ? await resolveBokutachiUrl(row) : buildStaticIrUrl(row, target);
    if (url) {
      void window.managerApi.openExternal(url);
    } else if (target === 'bokutachi') {
      showToast('bokutachiに登録された譜面が見つかりませんでした。');
    }
  }

  function openPathFromMenu(row: TableChartRow): void {
    void window.managerApi.openPath({ path: row.path, folder: row.folder });
    setContextMenu(null);
  }

  function handleDragOver(event: React.DragEvent): void {
    event.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  }

  function handleDragLeave(event: React.DragEvent): void {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setIsDragOver(false);
  }

  async function handleDrop(event: React.DragEvent): Promise<void> {
    event.preventDefault();
    setIsDragOver(false);
    if (isAudioConversionBusy) return;
    setContextMenu(null);
    setFilterMenu(null);

    const paths = [...event.dataTransfer.files]
      .map((file) => window.managerApi.getPathForFile(file))
      .filter(Boolean);
    if (paths.length === 0) {
      showToast('No local file path was found in the dropped item.');
      return;
    }

    setIsImportBusy(true);
    setImportBusyMessage('Searching destination...');
    try {
      const analysis = await window.managerApi.analyzeDroppedChart(paths);
      if (!analysis.ok) {
        showToast(analysis.message);
        return;
      }
      setImportAnalysis(analysis);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImportBusy(false);
      setImportBusyMessage('');
    }
  }

  async function confirmImportCandidate(): Promise<void> {
    if (!importAnalysis?.dropped || !selectedImportCandidateId) return;
    const candidate = importAnalysis.candidates.find((item) => item.id === selectedImportCandidateId);
    if (!candidate) return;

    setIsImportBusy(true);
    setImportBusyMessage('Importing files...');
    try {
      const result = await window.managerApi.importDroppedChart({
        sourcePaths: importAnalysis.sourcePaths,
        destinationDirectory: candidate.destinationDirectory
      });
      showToast(result.message);
      if (result.ok) {
        setImportAnalysis(null);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImportBusy(false);
      setImportBusyMessage('');
    }
  }

  async function mergeDuplicateGroup(group: DuplicateChartGroup, targetDirectory: string, sourceDirectories: string[]): Promise<void> {
    const directories = uniqueStrings(sourceDirectories);
    const sourceOnlyDirectories = directories.filter((directory) => !samePathText(directory, targetDirectory));
    if (directories.length < 2 || sourceOnlyDirectories.length === 0) {
      showToast('Select at least one source directory in addition to the merge target.');
      return;
    }

    const confirmed = window.confirm([
      `Merge ${directories.length} directories for "${group.title}" into:`,
      targetDirectory,
      '',
      'Existing files in the target directory will be skipped.',
      'The other selected directories will be deleted after files are moved.',
      '',
      ...sourceOnlyDirectories.map((directory) => `Delete: ${directory}`)
    ].join('\n'));
    if (!confirmed) return;

    setMergeBusyGroupId(group.id);
    setMergeBusyMessage('Merging duplicate directories...');
    try {
      const result = await window.managerApi.mergeDuplicateDirectories({ targetDirectory, sourceDirectories: directories });
      showToast(result.message);
      if (result.ok) {
        const mergedGroupIds = automaticallyMergedDuplicateGroupIds(duplicateGroups, targetDirectory, directories);
        setMergedDuplicateGroupIds((current) => new Set([...current, ...mergedGroupIds]));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setMergeBusyGroupId('');
      setMergeBusyMessage('');
    }
  }

  if (loading || !state) {
    return <div className="boot">読み込み中...</div>;
  }

  return (
    <div className={`app ${isDragOver ? 'drag-over' : ''}`} onClick={() => { setContextMenu(null); setFilterMenu(null); }} onDragEnter={handleDragOver} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={(event) => void handleDrop(event)}>
      <header className="topbar">
        <div className="brand">beatoraja Manager</div>
        <button className="icon-text" onClick={chooseRoot} disabled={isAudioConversionBusy} title="beatoraja directory">
          <Settings size={16} />
          <span>{state.beatoraja?.root ?? 'Select beatoraja'}</span>
        </button>
        <select value={state.selectedPlayer?.id ?? ''} disabled={isAudioConversionBusy} onChange={(event) => void selectPlayer(event.target.value)}>
          {state.players.map((player) => <option key={player.id} value={player.id}>{player.name} ({player.id})</option>)}
        </select>
        <button className="icon-button" onClick={() => void load()} disabled={isAudioConversionBusy} title="Reload">
          <RefreshCw size={16} />
        </button>
        <div className="topbar-counts">
          <span>{state.tables.length} tables</span>
          <span>{activeView === 'duplicates' ? `${duplicateGroups.length} duplicate groups` : activeView === 'audio' ? 'WAV to OGG' : activeView === 'bga' ? 'BGA cleanup' : isListLoading ? 'loading...' : `${visibleRows.length} charts`}</span>
        </div>
      </header>

      {state.diagnostics.length > 0 && (
        <div className="diagnostics">{state.diagnostics.join(' / ')}</div>
      )}

      <div className="workspace">
        <aside className="sidebar">
          <section className="panel sidebar-section table-section">
            <div className="panel-title">Tables</div>
            <button className={`tree-row ${activeView === 'charts' && !selectedBmsRoot && selectedTableId === null ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={() => void selectTable(null)}>
              <span>All Tables</span>
              <small>{state.rows.length}</small>
            </button>
            <div className="table-list">
              {sortedTables.map((table) => (
                <button key={table.id} className={`tree-row ${activeView === 'charts' && !selectedBmsRoot && table.id === selectedTableId ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={() => void selectTable(table.id)} title={table.name}>
                  <span>{table.name}</span>
                  <small>{table.chartCount} / {table.missingCount}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel sidebar-section roots-section">
            <div className="panel-title">BMS Path</div>
            <button className={`tree-row duplicate-nav-row ${activeView === 'duplicates' ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={selectDuplicates}>
              <Copy size={14} />
              <span>Duplicate Charts</span>
              <small>{duplicateGroups.length}</small>
            </button>
            <button className={`tree-row duplicate-nav-row ${activeView === 'audio' ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={selectAudioConversion}>
              <AudioLines size={14} />
              <span>WAV to OGG</span>
            </button>
            <button className={`tree-row duplicate-nav-row ${activeView === 'bga' ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={selectBgaCleanup}>
              <Trash2 size={14} />
              <span>BGA Cleanup</span>
            </button>
            <div className="roots-list">
              {state.bmsRootNodes.map((node) => (
                <button key={node.id} className={`tree-row path-row ${activeView === 'charts' && selectedBmsRoot?.path === node.path ? 'selected' : ''}`} disabled={isAudioConversionBusy} onClick={() => selectBmsRoot(node)} title={node.path}>
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
              <strong>{activeView === 'duplicates' ? 'Duplicate Charts' : activeView === 'audio' ? 'Audio Conversion' : activeView === 'bga' ? 'BGA Cleanup' : selectedBmsRoot?.name ?? activeTable?.name ?? 'All Tables'}</strong>
              <span>{activeView === 'duplicates' ? `${duplicateGroups.length} groups / ${redundantCopyCount} redundant copies` : activeView === 'audio' ? 'Convert WAV files without changing charts' : activeView === 'bga' ? 'Remove legacy BGA files when matching MP4 exists' : makeSubtitle(selectedBmsRoot, activeTable, visibleRows.length)}</span>
            </div>
            {activeView !== 'audio' && activeView !== 'bga' && <label className="searchbox">
              <Search size={16} />
              <input value={searchText} onChange={(event) => void updateSearch(event.target.value)} placeholder={activeView === 'duplicates' ? 'Search title / artist / hash / path' : 'Search title / artist / hash / table'} />
            </label>}
            {activeView === 'charts' && activeFilterCount > 0 && (
              <button className="icon-text clear-filters" onClick={() => setColumnFilters({})} title="Clear column filters">
                <X size={16} />
                <span>{activeFilterCount} filters</span>
              </button>
            )}
            {activeView === 'charts' && (
              <button className="icon-text export-button" disabled={isAudioConversionBusy || (!activeTable && !selectedBmsRoot)} onClick={() => void exportActiveSelection()} title={selectedBmsRoot ? 'Export selected BMS Path' : 'Export selected table'}>
                <Download size={16} />
                <span>Export</span>
              </button>
            )}
          </div>
          {exportMessage && <div className="export-message">{exportMessage}</div>}

          <div className="list-region">
            {activeView === 'duplicates' ? (
              <DuplicateGroupsView groups={visibleDuplicateGroups} totalGroups={duplicateGroups.length} busyGroupId={mergeBusyGroupId} onContextMenu={openContextMenu} onOpenPath={openPathFromMenu} onMerge={(group, targetDirectory, sourceDirectories) => void mergeDuplicateGroup(group, targetDirectory, sourceDirectories)} />
            ) : activeView === 'audio' ? (
              <AudioConversionView onMessage={showToast} onConversionBusyChange={setIsAudioConversionBusy} />
            ) : activeView === 'bga' ? (
              <BgaCleanupView onMessage={showToast} onCleanupBusyChange={setIsAudioConversionBusy} />
            ) : (
              <ChartTable rows={visibleRows} sort={sort} columnFilters={columnFilters} onSort={toggleSort} onFilterClick={openFilterMenu} onContextMenu={openContextMenu} />
            )}
            {activeView === 'charts' && isListLoading && <div className="loading-overlay">読み込み中...</div>}
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

      {isDragOver && (
        <div className="drop-overlay">
          <div>
            <Upload size={28} />
            <span>Drop chart file</span>
          </div>
        </div>
      )}

      {importAnalysis && (
        <ChartImportDialog
          analysis={importAnalysis}
          selectedCandidateId={selectedImportCandidateId}
          busy={isImportBusy}
          onSelect={setSelectedImportCandidateId}
          onCancel={() => setImportAnalysis(null)}
          onConfirm={() => void confirmImportCandidate()}
        />
      )}

      {isImportBusy && importBusyMessage && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div>
            <RefreshCw size={24} />
            <span>{importBusyMessage}</span>
          </div>
        </div>
      )}

      {mergeBusyMessage && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div>
            <RefreshCw size={24} />
            <span>{mergeBusyMessage}</span>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className={`context-menu submenu-${contextMenu.submenuSide}`} style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button disabled={!contextMenu.row.url1} onClick={() => openExternalFromMenu(contextMenu.row.url1)}><ExternalLink size={14} />Open URL1</button>
          <button disabled={!contextMenu.row.url2} onClick={() => openExternalFromMenu(contextMenu.row.url2)}><ExternalLink size={14} />Open URL2</button>
          <button disabled={!contextMenu.row.path && !contextMenu.row.folder} onClick={() => openPathFromMenu(contextMenu.row)}><FolderOpen size={14} />Open in Explorer</button>
          <div className="context-submenu">
            <button disabled={!hasAnyIrTarget(contextMenu.row)}><ExternalLink size={14} /><span>Open IR</span><ChevronRight size={14} /></button>
            <div className="context-submenu-panel">
              <button disabled={!canOpenBokutachi(contextMenu.row)} onClick={() => void openIrFromMenu(contextMenu.row, 'bokutachi')}>bokutachi</button>
              <button disabled={!contextMenu.row.sha256} onClick={() => void openIrFromMenu(contextMenu.row, 'mocha')}>mocha-repository</button>
              <button disabled={!contextMenu.row.sha256} onClick={() => void openIrFromMenu(contextMenu.row, 'minir')}>MinIR</button>
              <button disabled={!contextMenu.row.md5} onClick={() => void openIrFromMenu(contextMenu.row, 'bms-ir')}>BMS-IR</button>
            </div>
          </div>
          <button onClick={() => { void navigator.clipboard.writeText(contextMenu.row.sha256 || contextMenu.row.md5); setContextMenu(null); }}><Copy size={14} />Copy Hash</button>
          <button onClick={() => { setSimilarTarget(contextMenu.row); setContextMenu(null); }}><GitBranch size={14} />Same Song Search</button>
        </div>
      )}

      {toastMessage && <div className="toast-message" role="status" aria-live="polite">{toastMessage}</div>}
    </div>
  );

  function showToast(message: string): void {
    if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage('');
      toastTimeoutRef.current = null;
    }, 3500);
  }
}

function AudioConversionView({ onMessage, onConversionBusyChange }: { onMessage(message: string): void; onConversionBusyChange(busy: boolean): void }): JSX.Element {
  const [folders, setFolders] = useState<AudioFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [scannedDirectories, setScannedDirectories] = useState(0);
  const [busyPath, setBusyPath] = useState('');
  const [isConvertingAll, setIsConvertingAll] = useState(false);
  const [isCancelRequested, setIsCancelRequested] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const scanIdRef = useRef('');
  const cancelRequestedRef = useRef(false);
  const folderPathsRef = useRef<Set<string>>(new Set());

  const isBusy = Boolean(busyPath) || isConvertingAll;

  useEffect(() => {
    const unsubscribe = window.managerApi.onAudioFolderScanUpdate((update) => {
      if (update.scanId !== scanIdRef.current) return;
      if (update.error) {
        onMessage(update.error);
        setLoading(false);
        return;
      }
      setScannedDirectories(update.scannedDirectories);
      if (update.done) {
        folderPathsRef.current = new Set(update.folders.map((folder) => folder.path));
        setFolders(update.folders);
        setLoading(false);
      }
    });
    void reload();
    return () => {
      const scanId = scanIdRef.current;
      if (scanId) void window.managerApi.cancelAudioFolderScan(scanId);
      onConversionBusyChange(false);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    onConversionBusyChange(isBusy);
  }, [isBusy, onConversionBusyChange]);

  async function reload(): Promise<void> {
    const previousScanId = scanIdRef.current;
    if (previousScanId) void window.managerApi.cancelAudioFolderScan(previousScanId);
    scanIdRef.current = '';
    folderPathsRef.current = new Set();
    setFolders([]);
    setScannedDirectories(0);
    setLoading(true);
    try {
      scanIdRef.current = await window.managerApi.startAudioFolderScan();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  async function convertOne(folder: AudioFolder, confirmed = false): Promise<boolean> {
    if (!confirmed && !window.confirm(`Convert WAV files in this folder to OGG?\n\n${folder.path}\n\nIf a matching OGG already exists, the WAV will be removed without reconverting.`)) return false;
    setBusyPath(folder.path);
    try {
      const result = await window.managerApi.convertAudioFolder(folder.path);
      onMessage(result.message);
      if (result.ok) {
        folderPathsRef.current.delete(folder.path);
        setFolders((previous) => previous.filter((item) => item.path !== folder.path));
      }
      return result.ok;
    } catch (error) {
      onMessage(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusyPath('');
    }
  }

  async function convertAll(): Promise<void> {
    if (!window.confirm(`Convert WAV files in all ${folders.length} folders to OGG?\n\nIf matching OGG files already exist, those WAV files will be removed without reconverting.`)) return;
    const batch = [...folders];
    cancelRequestedRef.current = false;
    setIsCancelRequested(false);
    setIsConvertingAll(true);
    setTotal(batch.length);
    setCompleted(0);
    let succeeded = 0;
    let attempted = 0;
    try {
      for (let index = 0; index < batch.length; index += 1) {
        if (cancelRequestedRef.current) break;
        if (await convertOne(batch[index], true)) succeeded += 1;
        attempted = index + 1;
        setCompleted(attempted);
      }
    } finally {
      const stopped = cancelRequestedRef.current && attempted < batch.length;
      const needsAttention = attempted - succeeded;
      setIsConvertingAll(false);
      setIsCancelRequested(false);
      cancelRequestedRef.current = false;
      setTotal(0);
      await reload();
      onMessage(stopped
        ? `${succeeded} / ${batch.length} folders converted${needsAttention ? `, ${needsAttention} need attention` : ''}. Stopped after the current folder finished.`
        : `${succeeded} / ${batch.length} folders converted${needsAttention ? `, ${needsAttention} need attention` : ''}.`);
    }
  }

  function requestCancelAll(): void {
    cancelRequestedRef.current = true;
    setIsCancelRequested(true);
    onMessage('Stop requested. Conversion will end after the current folder finishes.');
  }

  return (
    <div className="audio-conversion">
      <div className="audio-actions">
        <div>
          <strong>{loading ? 'Scanning BMS paths...' : `${folders.length} folders with WAV files`}</strong>
          <span>{loading ? `${scannedDirectories.toLocaleString()} directories checked. The list will appear when scanning is complete.` : 'Existing OGG files are kept; matching WAV files are removed.'}</span>
        </div>
        <button onClick={() => void reload()} disabled={isBusy}><RefreshCw size={15} />Rescan</button>
        {isConvertingAll ? (
          <button className="stop-conversion-button" onClick={requestCancelAll} disabled={isCancelRequested}><X size={15} />{isCancelRequested ? 'Stopping...' : 'Stop'}</button>
        ) : (
          <button className="convert-all-button" onClick={() => void convertAll()} disabled={loading || isBusy || folders.length === 0}><AudioLines size={15} />Convert All</button>
        )}
      </div>
      {total > 0 && <div className="audio-progress"><div style={{ width: `${completed / total * 100}%` }} /><span>{isCancelRequested ? `Stopping after current folder... ${completed} / ${total}` : `${completed} / ${total} folders`}</span></div>}
      <div className="audio-folder-list">
        {!loading && folders.length === 0 && <div className="duplicate-empty"><AudioLines size={28} /><strong>No WAV files found</strong><span>All scanned BMS folders are already converted.</span></div>}
        {loading && folders.length === 0 && <div className="duplicate-empty"><RefreshCw className="spin" size={28} /><strong>Scanning BMS folders...</strong><span>The full list will appear after scanning is complete.</span></div>}
        {folders.map((folder) => (
          <div className="audio-folder-row" key={folder.path}>
            <FolderOpen size={17} />
            <div><strong>{folder.name}</strong><span title={folder.path}>{folder.path}</span></div>
            <b>WAV found</b>
            <button disabled={isBusy} onClick={() => void convertOne(folder)}>{busyPath === folder.path ? <RefreshCw className="spin" size={14} /> : <AudioLines size={14} />}Convert</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BgaCleanupView({ onMessage, onCleanupBusyChange }: { onMessage(message: string): void; onCleanupBusyChange(busy: boolean): void }): JSX.Element {
  const [folders, setFolders] = useState<BgaFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [scannedDirectories, setScannedDirectories] = useState(0);
  const [busyPath, setBusyPath] = useState('');
  const [isCleaningAll, setIsCleaningAll] = useState(false);
  const [isCancelRequested, setIsCancelRequested] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const scanIdRef = useRef('');
  const cancelRequestedRef = useRef(false);
  const folderPathsRef = useRef<Set<string>>(new Set());

  const isBusy = Boolean(busyPath) || isCleaningAll;
  const duplicateFileCount = folders.reduce((sum, folder) => sum + folder.duplicates.length, 0);

  useEffect(() => {
    const unsubscribe = window.managerApi.onBgaFolderScanUpdate((update) => {
      if (update.scanId !== scanIdRef.current) return;
      if (update.error) {
        onMessage(update.error);
        setLoading(false);
        return;
      }
      setScannedDirectories(update.scannedDirectories);
      if (update.done) {
        folderPathsRef.current = new Set(update.folders.map((folder) => folder.path));
        setFolders(update.folders);
        setLoading(false);
      }
    });
    void reload();
    return () => {
      const scanId = scanIdRef.current;
      if (scanId) void window.managerApi.cancelBgaFolderScan(scanId);
      onCleanupBusyChange(false);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    onCleanupBusyChange(isBusy);
  }, [isBusy, onCleanupBusyChange]);

  async function reload(): Promise<void> {
    const previousScanId = scanIdRef.current;
    if (previousScanId) void window.managerApi.cancelBgaFolderScan(previousScanId);
    scanIdRef.current = '';
    folderPathsRef.current = new Set();
    setFolders([]);
    setScannedDirectories(0);
    setLoading(true);
    try {
      scanIdRef.current = await window.managerApi.startBgaFolderScan();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  async function cleanupOne(folder: BgaFolder, confirmed = false): Promise<boolean> {
    if (!confirmed && !window.confirm(`Delete legacy BGA files in this folder?\n\n${folder.path}\n\nOnly MPG, MPEG, and WMV files with matching MP4 files will be deleted. Chart files will not be changed.`)) return false;
    setBusyPath(folder.path);
    try {
      const result = await window.managerApi.cleanupBgaFolder(folder.path);
      onMessage(result.message);
      if (result.ok) {
        folderPathsRef.current.delete(folder.path);
        setFolders((previous) => previous.filter((item) => item.path !== folder.path));
      }
      return result.ok;
    } catch (error) {
      onMessage(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setBusyPath('');
    }
  }

  async function cleanupAll(): Promise<void> {
    if (!window.confirm(`Delete duplicate legacy BGA files in all ${folders.length} folders?\n\nOnly MPG, MPEG, and WMV files with matching MP4 files will be deleted. Chart files will not be changed.`)) return;
    const batch = [...folders];
    cancelRequestedRef.current = false;
    setIsCancelRequested(false);
    setIsCleaningAll(true);
    setTotal(batch.length);
    setCompleted(0);
    let succeeded = 0;
    let attempted = 0;
    try {
      for (let index = 0; index < batch.length; index += 1) {
        if (cancelRequestedRef.current) break;
        if (await cleanupOne(batch[index], true)) succeeded += 1;
        attempted = index + 1;
        setCompleted(attempted);
      }
    } finally {
      const stopped = cancelRequestedRef.current && attempted < batch.length;
      const needsAttention = attempted - succeeded;
      setIsCleaningAll(false);
      setIsCancelRequested(false);
      cancelRequestedRef.current = false;
      setTotal(0);
      await reload();
      onMessage(stopped
        ? `${succeeded} / ${batch.length} folders cleaned${needsAttention ? `, ${needsAttention} need attention` : ''}. Stopped after the current folder finished.`
        : `${succeeded} / ${batch.length} folders cleaned${needsAttention ? `, ${needsAttention} need attention` : ''}.`);
    }
  }

  function requestCancelAll(): void {
    cancelRequestedRef.current = true;
    setIsCancelRequested(true);
    onMessage('Stop requested. Cleanup will end after the current folder finishes.');
  }

  return (
    <div className="audio-conversion">
      <div className="audio-actions">
        <div>
          <strong>{loading ? 'Scanning BMS paths...' : `${folders.length} folders / ${duplicateFileCount} duplicate BGA files`}</strong>
          <span>{loading ? `${scannedDirectories.toLocaleString()} directories checked. The list will appear when scanning is complete.` : 'MP4 files and chart definitions are kept; matching legacy BGA files are removed.'}</span>
        </div>
        <button onClick={() => void reload()} disabled={isBusy}><RefreshCw size={15} />Rescan</button>
        {isCleaningAll ? (
          <button className="stop-conversion-button" onClick={requestCancelAll} disabled={isCancelRequested}><X size={15} />{isCancelRequested ? 'Stopping...' : 'Stop'}</button>
        ) : (
          <button className="convert-all-button" onClick={() => void cleanupAll()} disabled={loading || isBusy || folders.length === 0}><Trash2 size={15} />Delete All</button>
        )}
      </div>
      {total > 0 && <div className="audio-progress"><div style={{ width: `${completed / total * 100}%` }} /><span>{isCancelRequested ? `Stopping after current folder... ${completed} / ${total}` : `${completed} / ${total} folders`}</span></div>}
      <div className="audio-folder-list">
        {!loading && folders.length === 0 && <div className="duplicate-empty"><Trash2 size={28} /><strong>No duplicate BGA found</strong><span>All scanned BMS folders are already clean.</span></div>}
        {loading && folders.length === 0 && <div className="duplicate-empty"><RefreshCw className="spin" size={28} /><strong>Scanning BMS folders...</strong><span>The full list will appear after scanning is complete.</span></div>}
        {folders.map((folder) => {
          const summary = summarizeBgaDuplicates(folder);
          return (
            <div className="audio-folder-row bga-folder-row" key={folder.path}>
              <FolderOpen size={17} />
              <div>
                <strong>{folder.name}</strong>
                <span title={folder.path}>{folder.path}</span>
                <span title={summary}>{summary}</span>
              </div>
              <b>{folder.duplicates.length} files</b>
              <button disabled={isBusy} onClick={() => void cleanupOne(folder)}>{busyPath === folder.path ? <RefreshCw className="spin" size={14} /> : <Trash2 size={14} />}Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DuplicateGroupsView({ groups, totalGroups, busyGroupId, onContextMenu, onOpenPath, onMerge }: {
  groups: DuplicateChartGroup[];
  totalGroups: number;
  busyGroupId: string;
  onContextMenu(event: React.MouseEvent, row: TableChartRow): void;
  onOpenPath(row: TableChartRow): void;
  onMerge(group: DuplicateChartGroup, targetDirectory: string, sourceDirectories: string[]): void;
}): JSX.Element {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [checkedDirectories, setCheckedDirectories] = useState<Record<string, Set<string>>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef(0);
  const didInitializeExpandedGroupsRef = useRef(false);

  useEffect(() => {
    setExpandedGroupIds((current) => {
      const visibleIds = new Set(groups.map((group) => group.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      if (!didInitializeExpandedGroupsRef.current && next.size === 0 && groups[0]) next.add(groups[0].id);
      return next;
    });
    if (groups.length > 0) didInitializeExpandedGroupsRef.current = true;
  }, [groups]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(scrollTopRef.current, maxScrollTop);
  }, [groups]);

  useEffect(() => {
    setMergeTargets((currentTargets) => {
      const nextTargets: Record<string, string> = {};
      for (const group of groups) {
        const directories = duplicateDirectories(group);
        if (directories.length === 0) continue;
        const currentTarget = currentTargets[group.id];
        nextTargets[group.id] = directories.some((directory) => samePathText(directory.path, currentTarget)) ? currentTarget : directories[0].path;
      }
      return nextTargets;
    });

    setCheckedDirectories((currentChecked) => {
      const nextChecked: Record<string, Set<string>> = {};
      for (const group of groups) {
        const directories = duplicateDirectories(group).map((directory) => directory.path);
        if (directories.length === 0) continue;
        const target = mergeTargets[group.id] && directories.some((directory) => samePathText(directory, mergeTargets[group.id]))
          ? mergeTargets[group.id]
          : directories[0];
        const current = currentChecked[group.id];
        const checked = current ? new Set(directories.filter((directory) => [...current].some((checkedDirectory) => samePathText(checkedDirectory, directory)))) : new Set(directories);
        checked.add(target);
        nextChecked[group.id] = checked;
      }
      return nextChecked;
    });
  }, [groups]);

  function toggleGroup(groupId: string): void {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function selectMergeTarget(group: DuplicateChartGroup, directory: string): void {
    setMergeTargets((current) => ({ ...current, [group.id]: directory }));
    setCheckedDirectories((current) => {
      const checked = new Set(current[group.id] ?? []);
      checked.add(directory);
      return { ...current, [group.id]: checked };
    });
  }

  function toggleMergeDirectory(group: DuplicateChartGroup, directory: string): void {
    const target = mergeTargets[group.id];
    if (samePathText(directory, target)) return;
    setCheckedDirectories((current) => {
      const checked = new Set(current[group.id] ?? []);
      if (checked.has(directory)) checked.delete(directory);
      else checked.add(directory);
      if (target) checked.add(target);
      return { ...current, [group.id]: checked };
    });
  }

  if (groups.length === 0) {
    return (
      <div className="duplicate-empty">
        <Copy size={28} />
        <strong>{totalGroups === 0 ? 'No duplicate charts found' : 'No duplicate groups match the search'}</strong>
        <span>Duplicates require an exact SHA-256 or MD5 match in the installed chart library.</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="duplicate-groups"
      onScroll={(event) => {
        scrollTopRef.current = event.currentTarget.scrollTop;
      }}
    >
      {groups.map((group) => {
        const expanded = expandedGroupIds.has(group.id);
        const directories = duplicateDirectories(group);
        const mergeTarget = mergeTargets[group.id] ?? directories[0]?.path ?? '';
        const selectedDirectories = checkedDirectories[group.id] ?? new Set(directories.map((directory) => directory.path));
        const selectedDirectoryList = directories
          .map((directory) => directory.path)
          .filter((directory) => selectedDirectories.has(directory) || samePathText(directory, mergeTarget));
        const canMerge = directories.length > 1 && selectedDirectoryList.length > 1 && !busyGroupId;
        return (
          <section key={group.id} className={`duplicate-group ${expanded ? 'expanded' : ''}`}>
            <button className="duplicate-group-header" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="duplicate-count">{group.copies.length}</span>
              <span className="duplicate-heading">
                <strong title={group.title}>{group.title}</strong>
                <small title={group.artist}>{group.artist || '(unknown artist)'}</small>
              </span>
              <span className="duplicate-hashes">
                {group.sharedSha256.length > 0 && <span title={group.sharedSha256.join('\n')}>SHA-256 {shortHash(group.sharedSha256[0])}</span>}
                {group.sharedMd5.length > 0 && <span title={group.sharedMd5.join('\n')}>MD5 {shortHash(group.sharedMd5[0])}</span>}
              </span>
              <span className="duplicate-copy-label">{group.copies.length} copies</span>
            </button>
            {expanded && (
              <>
                <div className="duplicate-merge-panel">
                  <div className="duplicate-merge-title">
                    <strong>Merge directories</strong>
                    <span>{directories.length > 1 ? 'Choose directories to merge and the destination.' : 'All duplicate charts are already in one directory.'}</span>
                  </div>
                  {directories.length > 1 && (
                    <>
                      <div className="duplicate-directory-list">
                        {directories.map((directory) => {
                          const isTarget = samePathText(directory.path, mergeTarget);
                          const checked = isTarget || selectedDirectories.has(directory.path);
                          return (
                            <label key={directory.path} className={`duplicate-directory-row ${isTarget ? 'target' : ''}`}>
                              <input type="checkbox" checked={checked} disabled={isTarget || Boolean(busyGroupId)} onChange={() => toggleMergeDirectory(group, directory.path)} />
                              <input type="radio" name={`merge-target-${group.id}`} checked={isTarget} disabled={Boolean(busyGroupId)} onChange={() => selectMergeTarget(group, directory.path)} />
                              <span className="duplicate-directory-path" title={directory.path}>{directory.path}</span>
                              <small>{directory.copyCount} chart{directory.copyCount === 1 ? '' : 's'}</small>
                            </label>
                          );
                        })}
                      </div>
                      <button className="duplicate-merge-button" disabled={!canMerge} onClick={() => onMerge(group, mergeTarget, selectedDirectoryList)}>
                        {busyGroupId === group.id ? 'Merging...' : 'Merge selected directories'}
                      </button>
                    </>
                  )}
                </div>
                <div className="duplicate-locations">
                  {group.copies.map((row, index) => (
                    <div key={row.id} className="duplicate-location" onContextMenu={(event) => onContextMenu(event, row)}>
                      <span className="duplicate-location-index">{index + 1}</span>
                      <span className="duplicate-location-main">
                        <strong title={row.path || row.folder}>{row.path || row.folder || '(path unavailable)'}</strong>
                        <small>{duplicateLocationDetails(row)}</small>
                      </span>
                      <button className="duplicate-open-button" disabled={!row.path && !row.folder} onClick={() => onOpenPath(row)} title="Open in Explorer">
                        <FolderOpen size={15} />
                        <span>Open</span>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ChartImportDialog({ analysis, selectedCandidateId, busy, onSelect, onCancel, onConfirm }: { analysis: ChartImportAnalysis; selectedCandidateId: string; busy: boolean; onSelect(id: string): void; onCancel(): void; onConfirm(): void }): JSX.Element {
  const selectedCandidate = analysis.candidates.find((candidate) => candidate.id === selectedCandidateId);
  return (
    <div className="import-dialog-backdrop" onClick={onCancel}>
      <section className="import-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="import-dialog-header">
          <div>
            <strong>Chart Import</strong>
            <span>{analysis.dropped?.fileName ?? 'No chart file'}</span>
          </div>
          <button className="icon-button" onClick={onCancel} title="Close"><X size={16} /></button>
        </div>

        {analysis.dropped && (
          <div className="import-source-grid">
            <span>Title</span><strong title={`${analysis.dropped.title} ${analysis.dropped.subtitle}`}>{analysis.dropped.title || '(empty)'} {analysis.dropped.subtitle}</strong>
            <span>Artist</span><strong title={analysis.dropped.artist}>{analysis.dropped.artist || '(empty)'}</strong>
            <span>Source</span><strong title={analysis.dropped.sourcePath}>{analysis.dropped.sourcePath}</strong>
          </div>
        )}

        {analysis.message && <div className="import-message">{analysis.message}</div>}

        {analysis.companionPaths.length > 0 && (
          <div className="import-companions">
            <span>Related items to import</span>
            <div>
              {analysis.companionPaths.map((filePath) => <strong key={filePath} title={filePath}>{filePath}</strong>)}
            </div>
          </div>
        )}

        <div className="import-candidate-list">
          {analysis.candidates.map((candidate) => (
            <ImportCandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedCandidateId}
              disabled={busy}
              onSelect={() => {
                if (candidate.id === selectedCandidateId) {
                  onConfirm();
                } else {
                  onSelect(candidate.id);
                }
              }}
            />
          ))}
          {analysis.candidates.length === 0 && (
            <div className="import-empty">No candidate folders found.</div>
          )}
        </div>

        <div className="import-dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary-action" disabled={!selectedCandidate || busy} onClick={onConfirm}>
            {busy ? 'Importing...' : 'Import'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportCandidateRow({ candidate, selected, disabled, onSelect }: { candidate: ImportCandidate; selected: boolean; disabled: boolean; onSelect(): void }): JSX.Element {
  return (
    <button className={`import-candidate ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onSelect}>
      <div className="import-candidate-score">{Math.round(candidate.confidence * 100)}%</div>
      <div className="import-candidate-main">
        <div className="import-candidate-path" title={candidate.destinationDirectory}>{candidate.destinationDirectory}</div>
        <div className="import-candidate-reason">
          <span>{candidate.matchReason}</span>
          <span title={`${candidate.matchedTitle} / ${candidate.matchedArtist}`}>{candidate.matchedTitle}</span>
        </div>
        <div className="import-candidate-titles">
          {candidate.existingTitles.map((title) => <span key={title} title={title}>{title}</span>)}
        </div>
      </div>
    </button>
  );
}

function currentViewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function summarizeBgaDuplicates(folder: BgaFolder): string {
  const names = folder.duplicates.slice(0, 4).map((item) => `${item.legacyFileName} -> ${item.mp4FileName}`);
  return `${names.join(', ')}${folder.duplicates.length > names.length ? ', ...' : ''}`;
}

function ChartTable({ rows, compact = false, sort, columnFilters, onSort, onFilterClick, onContextMenu }: { rows: TableChartRow[]; compact?: boolean; sort: SortState; columnFilters: ChartColumnFilters; onSort(key: SortKey): void; onFilterClick(event: React.MouseEvent, key: SortKey): void; onContextMenu(event: React.MouseEvent, row: TableChartRow): void }): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<Record<SortKey, number>>(() => createColumnWidthState());
  const visibleColumns = chartColumns.filter((column) => !(compact && (column.key === 'tableName' || column.key === 'path')));
  const tableWidth = visibleColumns.reduce((sum, column) => sum + columnWidths[column.key], 0);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => `${rows[index]?.id ?? 'row'}:${index}`,
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
              <tr key={virtualRow.key} className={chartRowClass(row)} onContextMenu={(event) => onContextMenu(event, row)}>
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

function chartRowClass(row: TableChartRow): string {
  if (row.status !== 'NO SONG') return '';
  const hasUrl1 = Boolean(row.url1.trim());
  const hasUrl2 = Boolean(row.url2.trim());
  if (!hasUrl1 && !hasUrl2) return 'no-song-row no-song-url-none';
  if (hasUrl1 && !hasUrl2) return 'no-song-row no-song-url-1';
  if (!hasUrl1 && hasUrl2) return 'no-song-row no-song-url-2';
  return 'no-song-row no-song-url-both';
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

async function resolveBokutachiUrl(row: TableChartRow): Promise<string> {
  const game = bokutachiGameForMode(row.mode);
  if (!game || (!row.sha256 && !row.md5)) return '';
  return await window.managerApi.resolveBokutachiChartUrl({ game, sha256: row.sha256, md5: row.md5 }) ?? '';
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

function normalizePath(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '/').toLowerCase();
}

function filterDuplicateGroups(groups: DuplicateChartGroup[], query: string): DuplicateChartGroup[] {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return groups;
  return groups.filter((group) => normalizeSearchQuery([
    group.title,
    group.artist,
    ...group.sharedSha256,
    ...group.sharedMd5,
    ...group.copies.flatMap((row) => [row.title, row.subtitle, row.artist, row.path, row.folder])
  ].join(' ')).includes(normalizedQuery));
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

function duplicateLocationDetails(row: TableChartRow): string {
  const details = [
    row.songLevel != null ? `Level ${row.songLevel}` : '',
    row.notes != null ? `${row.notes} notes` : '',
    row.mode != null ? `${row.mode} keys` : ''
  ].filter(Boolean);
  return details.join(' / ') || 'Right-click for chart actions';
}

function duplicateDirectories(group: DuplicateChartGroup): { path: string; copyCount: number }[] {
  const directories = new Map<string, { path: string; copyCount: number }>();
  for (const row of group.copies) {
    const directory = chartDirectory(row);
    if (!directory) continue;
    const key = normalizePath(directory).replace(/\/+$/, '');
    const current = directories.get(key);
    if (current) current.copyCount += 1;
    else directories.set(key, { path: directory, copyCount: 1 });
  }
  return [...directories.values()].sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true, sensitivity: 'base' }));
}

function chartDirectory(row: TableChartRow): string {
  if (!row.path) return trimTrailingSeparators(row.folder);
  return directoryName(row.path);
}

function directoryName(filePath: string): string {
  const trimmed = trimTrailingSeparators(filePath);
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slashIndex >= 0 ? trimmed.slice(0, slashIndex) : '';
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = pathKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function samePathText(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = pathKey(a);
  const normalizedB = pathKey(b);
  return Boolean(normalizedA && normalizedB) && normalizedA === normalizedB;
}

function automaticallyMergedDuplicateGroupIds(groups: DuplicateChartGroup[], targetDirectory: string, sourceDirectories: string[]): string[] {
  const sourceKeys = new Set(sourceDirectories.map(pathKey).filter(Boolean));
  const targetKey = pathKey(targetDirectory);
  if (!targetKey || sourceKeys.size < 2) return [];

  return groups
    .filter((group) => {
      const directories = duplicateDirectories(group).map((directory) => directory.path);
      const originalKeys = new Set(directories.map(pathKey).filter(Boolean));
      if (originalKeys.size < 2) return false;
      if (![...originalKeys].some((key) => sourceKeys.has(key))) return false;

      const mergedKeys = new Set([...originalKeys].map((key) => sourceKeys.has(key) ? targetKey : key));
      return mergedKeys.size <= 1;
    })
    .map((group) => group.id);
}

function pathKey(value: string | null | undefined): string {
  return normalizePath(value).replace(/\/+$/, '');
}

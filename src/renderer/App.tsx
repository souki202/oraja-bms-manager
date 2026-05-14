import { useMemo, useState, useEffect } from 'react';
import { ExternalLink, FolderOpen, RefreshCw, Search, Settings, Copy, GitBranch, ChevronRight, ChevronDown } from 'lucide-react';
import type { DirectoryNode, ManagerState, TableChartRow } from '../shared/types';
import { findSimilarRows, rowMatchesSearch, statusClass } from '../shared/domain';

type ContextMenuState = {
  x: number;
  y: number;
  row: TableChartRow;
} | null;

export function App(): JSX.Element {
  const [state, setState] = useState<ManagerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [similarTarget, setSimilarTarget] = useState<TableChartRow | null>(null);
  const [expanded, setExpanded] = useState<Record<string, DirectoryNode[]>>({});

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    setLoading(true);
    const next = await window.managerApi.loadState();
    setState(next);
    setSearchText(next.settings.searchText ?? '');
    setSelectedTableId(next.settings.selectedTableId ?? next.tables[0]?.id ?? null);
    setLoading(false);
  }

  async function saveSettings(patch: Parameters<typeof window.managerApi.saveSettings>[0]): Promise<void> {
    const next = await window.managerApi.saveSettings(patch);
    setState(next);
  }

  const visibleRows = useMemo(() => {
    const rows = state?.rows ?? [];
    return rows.filter((row) => {
      const tableOk = selectedTableId ? row.tableId === selectedTableId : true;
      return tableOk && rowMatchesSearch(row, searchText);
    });
  }, [state, selectedTableId, searchText]);

  const similarRows = useMemo(() => {
    if (!state || !similarTarget) return [];
    return findSimilarRows(similarTarget, state.rows);
  }, [state, similarTarget]);

  const activeTable = state?.tables.find((table) => table.id === selectedTableId) ?? null;

  async function chooseRoot(): Promise<void> {
    const root = await window.managerApi.chooseRoot();
    if (root) await saveSettings({ beatorajaRoot: root });
  }

  async function selectPlayer(playerId: string): Promise<void> {
    await saveSettings({ selectedPlayerId: playerId });
  }

  async function selectTable(tableId: string | null): Promise<void> {
    setSelectedTableId(tableId);
    await saveSettings({ selectedTableId: tableId });
  }

  async function updateSearch(value: string): Promise<void> {
    setSearchText(value);
    await saveSettings({ searchText: value });
  }

  async function expandDirectory(node: DirectoryNode): Promise<void> {
    if (expanded[node.path]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[node.path];
        return next;
      });
      return;
    }
    const children = await window.managerApi.listDirectories(node.path);
    setExpanded((current) => ({ ...current, [node.path]: children }));
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
            <button className={`tree-row ${selectedTableId === null ? 'selected' : ''}`} onClick={() => void selectTable(null)}>
              <span>All Tables</span>
              <small>{state.rows.length}</small>
            </button>
            <div className="table-list">
              {state.tables.map((table) => (
                <button key={table.id} className={`tree-row ${table.id === selectedTableId ? 'selected' : ''}`} onClick={() => void selectTable(table.id)} title={table.name}>
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
                <DirectoryTree key={node.id} node={node} expanded={expanded} onToggle={expandDirectory} />
              ))}
            </div>
          </section>
        </aside>

        <main className="mainpane">
          <div className="toolbar">
            <div className="title-block">
              <strong>{activeTable?.name ?? 'All Tables'}</strong>
              <span>{activeTable ? `${activeTable.chartCount} charts / ${activeTable.missingCount} NO SONG` : `${visibleRows.length} charts`}</span>
            </div>
            <label className="searchbox">
              <Search size={16} />
              <input value={searchText} onChange={(event) => void updateSearch(event.target.value)} placeholder="Search title / artist / hash / table" />
            </label>
          </div>

          <ChartTable rows={visibleRows} onContextMenu={openContextMenu} />
        </main>

        {similarTarget && (
          <aside className="similar-pane">
            <div className="panel-title with-close">
              <span>Same Song</span>
              <button onClick={() => setSimilarTarget(null)}>Close</button>
            </div>
            <div className="similar-target">{similarTarget.title}</div>
            <ChartTable rows={similarRows} compact onContextMenu={openContextMenu} />
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

function DirectoryTree({ node, expanded, onToggle }: { node: DirectoryNode; expanded: Record<string, DirectoryNode[]>; onToggle(node: DirectoryNode): Promise<void> }): JSX.Element {
  const children = expanded[node.path];
  return (
    <div className="dir-node">
      <button className="tree-row path-row" onClick={() => void onToggle(node)} title={node.path}>
        {children ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{node.name}</span>
      </button>
      {children && <div className="dir-children">{children.map((child) => <DirectoryTree key={child.id} node={child} expanded={expanded} onToggle={onToggle} />)}</div>}
    </div>
  );
}

function ChartTable({ rows, compact = false, onContextMenu }: { rows: TableChartRow[]; compact?: boolean; onContextMenu(event: React.MouseEvent, row: TableChartRow): void }): JSX.Element {
  return (
    <div className={`chart-table-wrap ${compact ? 'compact' : ''}`}>
      <table className="chart-table">
        <thead>
          <tr>
            <th>FOLDER</th>
            <th>LEVEL</th>
            <th>TITLE</th>
            <th>ARTIST</th>
            <th>URL1</th>
            <th>URL2</th>
            <th>CLEAR</th>
            <th>NOTES</th>
            {!compact && <th>TABLE</th>}
            {!compact && <th>PATH</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onContextMenu={(event) => onContextMenu(event, row)}>
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

function UrlButton({ url }: { url: string }): JSX.Element {
  return (
    <button className="url-button" disabled={!url} onClick={() => void window.managerApi.openExternal(url)} title={url || 'No URL'}>
      <ExternalLink size={14} />
    </button>
  );
}
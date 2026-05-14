# beatoraja Chart Manager

Read-only desktop manager for beatoraja tables, chart search, missing-chart lookup, and per-player clear status browsing.

## Safety Boundary

This app is stored under `manager/` and treats the beatoraja root, `songdata.db`, `songinfo.db`, `table/`, `player/`, and BMS folders as read-only inputs. It opens URLs and Explorer folders, but it does not download, extract, update databases, or modify files outside `manager/`.

## Development

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
npm run typecheck
npm run lint
npm test
```
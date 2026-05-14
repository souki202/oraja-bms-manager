# beatoraja Chart Manager

Read-only desktop manager for beatoraja tables, chart search, missing-chart lookup, and per-player clear status browsing.

## Safety Boundary

This app treats the beatoraja root, `songdata.db`, `songinfo.db`, `table/`, `player/`, and BMS folders as read-only inputs. It opens URLs and Explorer folders, but it does not download, extract, update databases, or modify beatoraja files. Development settings are stored under `manager/data/`; packaged Windows builds store settings in the standard Electron user-data directory. Table export writes only to the folder selected in the export dialog.

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

## Windows Release Build

Build a Windows release zip that can run on machines without Node.js installed:

```powershell
npm install
npm run release:win
```

The distributable zip is written to `release/` and includes Electron, the compiled app, production dependencies, and the `sql.js` WebAssembly file used to read beatoraja SQLite databases. Extract the zip on the target Windows machine and run `beatoraja Chart Manager.exe`.

For a faster unpacked smoke-test build, use:

```powershell
npm run release:win:dir
```

For a single portable exe build on environments that allow Electron Builder's Windows signing helper extraction, use:

```powershell
npm run release:win:portable
```
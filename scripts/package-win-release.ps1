$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PackageJsonPath = Join-Path $ProjectRoot 'package.json'
$Package = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
$SourceDir = Join-Path $ProjectRoot 'release\win-unpacked'

if (-not (Test-Path $SourceDir)) {
  throw "Release source directory was not found: $SourceDir"
}

$ZipName = "beatoraja-chart-manager-$($Package.version)-win-x64.zip"
$ZipPath = Join-Path (Join-Path $ProjectRoot 'release') $ZipName

if (Test-Path $ZipPath) {
  Remove-Item $ZipPath -Force
}

Compress-Archive -Path (Join-Path $SourceDir '*') -DestinationPath $ZipPath -Force
Write-Host "Created $ZipPath"
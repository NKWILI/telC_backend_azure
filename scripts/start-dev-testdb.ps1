<#
.SYNOPSIS
  Runs the API against the disposable test database instead of production.

.DESCRIPTION
  Loads .env.test, then starts NestJS in watch mode on port 3001 — the port the
  Bruno collection points at.

  The app's ConfigModule reads .env, which holds the PRODUCTION connection
  string. Variables already present in the environment win over that file, so
  loading .env.test here is what keeps manual API testing off the real
  database. It refuses to start if .env.test looks like production.

.EXAMPLE
  .\scripts\start-dev-testdb.ps1
  .\scripts\start-dev-testdb.ps1 -Port 3002
#>
[CmdletBinding()]
param(
  [int]$Port = 3001,
  [string]$EnvFile = '.env.test'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path $EnvFile)) {
  Write-Error "$EnvFile not found. Create it with DATABASE_URL and DIRECT_URL from a disposable database branch."
}

$loaded = @()
foreach ($line in Get-Content $EnvFile) {
  # Skip blanks and comments; split on the FIRST '=' only, because connection
  # strings contain '=' in their query parameters.
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }

  $name, $value = $line -split '=', 2
  $name = $name.Trim()
  $value = $value.Trim().Trim('"').Trim("'")

  Set-Item -Path "env:$name" -Value $value
  $loaded += $name
}

# Refuse to point manual testing at production.
if ($env:DATABASE_URL -match 'ep-wandering-hall') {
  Write-Error "$EnvFile points at the production database. Use a disposable branch."
}

$dbHost = if ($env:DATABASE_URL -match '@([^/:]+)') { $matches[1] } else { 'unknown' }

Write-Host ""
Write-Host "  loaded    : $($loaded -join ', ')" -ForegroundColor DarkGray
Write-Host "  database  : $dbHost" -ForegroundColor Cyan
Write-Host "  api       : http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  swagger   : http://localhost:$Port/api-docs" -ForegroundColor Cyan
Write-Host ""

$env:PORT = "$Port"
npm run start:dev

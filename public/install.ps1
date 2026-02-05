$ErrorActionPreference = "Stop"

Write-Host "Surprisebot installer" -ForegroundColor Cyan

function Require-Node {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    $v = node -v
    $major = $v.TrimStart('v').Split('.')[0]
    if ([int]$major -ge 22) { return }
  }
  Write-Host "Node.js 22+ required. Install from https://nodejs.org/" -ForegroundColor Yellow
  throw "Node.js 22+ missing"
}

$NoOnboard = $false
$Minimal = $false

for ($i=0; $i -lt $args.Length; $i++) {
  switch ($args[$i]) {
    "--no-onboard" { $NoOnboard = $true }
    "--minimal" { $Minimal = $true }
    "--help" { 
      Write-Host "Usage: iwr -useb https://surprisebot.bot/install.ps1 | iex"
      Write-Host "Options: --no-onboard, --minimal"
      exit 0
    }
  }
}

Require-Node

Write-Host "Installing surprisebot..." -ForegroundColor Cyan
npm install -g surprisebot@latest

if (-not $NoOnboard) {
  if ($Minimal) {
    surprisebot init --minimal
  } else {
    surprisebot init --quickstart
  }
}

Write-Host "Surprisebot installed." -ForegroundColor Green

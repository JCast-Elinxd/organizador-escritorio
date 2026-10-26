param(
  [ValidateSet('help', 'version', 'long', 'mini', 'pause', 'resume', 'toggle', 'reset')]
  [string]$Command = 'help',
  [string[]]$Arguments = @()
)

$stretchlyPath = 'C:\Program Files\WindowsApps\33881JanHovancik.stretchly_1.22.1.0_x64__24fg4m0zq65je\app\Stretchly.exe'

Write-Host "Stretchly CLI test" -ForegroundColor Cyan
Write-Host "Executable: $stretchlyPath"

if (-not (Test-Path -LiteralPath $stretchlyPath)) {
  Write-Error "No existe el ejecutable de Stretchly en la ruta configurada."
  exit 1
}

$running = Get-Process -Name 'Stretchly' -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Procesos Stretchly activos: $($running.Count)" -ForegroundColor Yellow
} else {
  Write-Host "No hay una instancia activa de Stretchly. Se iniciara ahora."
  $startup = Start-Process -FilePath $stretchlyPath -PassThru
  Write-Host "Proceso iniciado con PID $($startup.Id)."
}

$cliArguments = @($Command) + $Arguments
Write-Host "Enviando: Stretchly.exe $($cliArguments -join ' ')" -ForegroundColor Green

$commandProcess = Start-Process `
  -FilePath $stretchlyPath `
  -ArgumentList $cliArguments `
  -PassThru

Write-Host "Comando enviado. PID del proceso CLI: $($commandProcess.Id)" -ForegroundColor Green
Write-Host "Si probaste 'long' o 'mini', revisa si aparece la ventana de descanso de Stretchly."
Write-Host "Ejemplos:" -ForegroundColor DarkGray
Write-Host "  .\test-stretchly.ps1 -Command help" -ForegroundColor DarkGray
Write-Host "  .\test-stretchly.ps1 -Command version" -ForegroundColor DarkGray
Write-Host "  .\test-stretchly.ps1 -Command long" -ForegroundColor DarkGray
Write-Host "  .\test-stretchly.ps1 -Command long" -ForegroundColor DarkGray

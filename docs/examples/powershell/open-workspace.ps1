<#
  Opens a set of apps in one press. Apps that are already open are skipped.
  Use it on a Script key (PowerShell, window: Hidden).
  Edit the list below. Use full paths. $env:LOCALAPPDATA and $env:ProgramFiles work too.
#>
$apps = @(
    "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
    "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
    "$env:LOCALAPPDATA\Discord\Update.exe --processStart Discord.exe"
)

$started = 0
foreach ($entry in $apps) {
    # Split "path.exe --args" into the program and its arguments.
    $i = $entry.ToLower().IndexOf('.exe')
    if ($i -lt 0) { Write-Output "Not an .exe: $entry"; continue }
    $exe = $entry.Substring(0, $i + 4)
    $arguments = $entry.Substring($i + 4).Trim()
    $name = [IO.Path]::GetFileNameWithoutExtension($exe)
    if ($arguments -match '--processStart\s+(\S+)') { $name = [IO.Path]::GetFileNameWithoutExtension($Matches[1]) }

    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { continue }
    if (-not (Test-Path $exe)) { Write-Output "Not found: $exe"; continue }
    if ($arguments) { Start-Process -FilePath $exe -ArgumentList $arguments } else { Start-Process -FilePath $exe }
    $started++
}
Write-Output "Workspace ready ($started opened)"

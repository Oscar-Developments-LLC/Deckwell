<#
  For a Status tile. Shows an NVIDIA GPU's temperature, with how busy it is as the bar.
  Needs nvidia-smi, which comes with the NVIDIA driver.
  Tile settings: Data source = Command, Runs in = PowerShell, Command:
      & "C:\Scripts\status-gpu.ps1"
#>
$deg = [char]0xB0
$line = & nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,name --format=csv,noheader,nounits 2>$null | Select-Object -First 1
if (-not $line) { Write-Output 'n/a|no NVIDIA GPU found||down'; exit 1 }
$parts = $line.Split(',') | ForEach-Object { $_.Trim() }
$temp = $parts[0]; $busy = $parts[1]; $name = $parts[2] -replace '^NVIDIA GeForce ', ''
'{0}{1}C|{2} - {3}% busy|{3}' -f $temp, $deg, $name, $busy

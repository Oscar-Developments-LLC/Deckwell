<#
  Switches Windows sound output between two devices, like headphones and speakers.
  Use it on a Script key (PowerShell, window: Hidden). The deck shows which device is now playing.

  Needs the free AudioDeviceCmdlets module. Install it once in PowerShell:
      Install-Module AudioDeviceCmdlets -Scope CurrentUser

  Then change the two names below to match your devices. Part of the name is enough.
  To see your device names, run:
      Get-AudioDevice -List | Where-Object Type -eq 'Playback' | Select-Object Index, Name
#>
$First  = 'Headphones'
$Second = 'Speakers'

$ErrorActionPreference = 'Stop'
Import-Module AudioDeviceCmdlets

$playback = Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' }
$a = $playback | Where-Object { $_.Name -like "*$First*" } | Select-Object -First 1
$b = $playback | Where-Object { $_.Name -like "*$Second*" } | Select-Object -First 1
if (-not $a -or -not $b) {
    Write-Output "Couldn't find '$First' or '$Second'. Check the names at the top of the script."
    exit 1
}

$current = Get-AudioDevice -Playback
if ($current.ID -eq $a.ID) { $target = $b } else { $target = $a }
Set-AudioDevice -ID $target.ID | Out-Null
Write-Output "Now playing on $($target.Name)"

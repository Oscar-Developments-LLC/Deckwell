<#
  Flips Windows between light and dark mode (apps and the taskbar).
  Use it on a Script key (PowerShell, window: Hidden).
#>
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$light = (Get-ItemProperty -Path $key -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme
if ($light -eq 0) { $new = 1 } else { $new = 0 }
Set-ItemProperty -Path $key -Name AppsUseLightTheme -Value $new -Type DWord
Set-ItemProperty -Path $key -Name SystemUsesLightTheme -Value $new -Type DWord
if ($new -eq 1) { Write-Output 'Light mode' } else { Write-Output 'Dark mode' }

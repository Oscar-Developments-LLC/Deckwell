<#
  For a Status tile. Prints how full drive C: is, in the format Deckwell reads:
      value|subtitle|bar
  Tile settings: Data source = Command, Runs in = PowerShell, Command:
      & "C:\Scripts\status-disk.ps1"
  (Use the folder you saved this file in.)
#>
$drive = 'C'
$d = Get-PSDrive $drive
$total = $d.Used + $d.Free
if ($total -le 0) { Write-Output "n/a|${drive}: not found||down"; exit 1 }
$pct = 100 * $d.Used / $total
'{0:0}%|{1}: {2:0} GB free' -f $pct, $drive, ($d.Free / 1GB)

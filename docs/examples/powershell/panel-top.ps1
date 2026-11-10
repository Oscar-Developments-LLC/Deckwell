# For a Panel with the Command source (PowerShell). Shows the apps using the most memory on this PC.
# Paste the lines below into the panel's Command box. (The built-in "This PC" source can also do this.)
Get-Process |
  Group-Object ProcessName |
  ForEach-Object { [pscustomobject]@{ App = $_.Name; MB = [math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } } |
  Sort-Object MB -Descending |
  Select-Object -First 12 |
  ForEach-Object { '{0,7} MB  {1}' -f $_.MB, $_.App }

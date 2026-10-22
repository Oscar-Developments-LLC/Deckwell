<#
  Keeps a Status tile up to date by PUSHING values to Deckwell, instead of Deckwell running a command.
  This one checks a website every 30 seconds and shows how fast it answered (or "down").

  1. Make a Status tile. Data source = Push, Feed name = website, Show = Up / down.
  2. Start this script and leave it running (see docs/status-tiles.md for running it at login):
         powershell -ExecutionPolicy Bypass -File push-website-check.ps1
#>
$Url   = 'https://example.com'
$Feed  = 'website'
$Every = 30

$tokenFile = Join-Path $env:APPDATA 'Deckwell\push-token.txt'
$token = (Get-Content $tokenFile -Raw).Trim()
$headers = @{ Authorization = "Bearer $token" }
$siteName = ([uri]$Url).Host

while ($true) {
    try {
        $ms = (Measure-Command { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 | Out-Null }).TotalMilliseconds
        $body = '{0:0} ms|{1}||up' -f $ms, $siteName
    } catch {
        $body = "down|$siteName||down"
    }
    try {
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8770/status/$Feed" -Headers $headers -Body $body | Out-Null
    } catch {
        Write-Output "Couldn't reach Deckwell. Is it running? $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $Every
}

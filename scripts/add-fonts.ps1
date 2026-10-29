# scripts/add-fonts.ps1 - fetch OFL woff2 fonts from Google Fonts into public/fonts.
# Usage: pwsh scripts/add-fonts.ps1
# Each family: query the CSS2 API with a Chrome UA (so it serves woff2),
# pick the latin-subset @font-face block per weight, download it.
$ErrorActionPreference = "Stop"
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
$dest = Join-Path (Split-Path $PSScriptRoot -Parent) "public\fonts"
New-Item -ItemType Directory -Force $dest | Out-Null

# family -> weights (each weight = one file). All OFL-licensed.
$FAMILIES = [ordered]@{
  "Montserrat"        = @(400, 700, 800)
  "Poppins"           = @(600, 800)
  "Bebas+Neue"        = @(400)
  "Anton"             = @(400)
  "Oswald"            = @(500, 700)
  "Playfair+Display"  = @(400, 700)   # italic fetched separately below
  "Merriweather"      = @(400)        # italic separately below
  "Lora"              = @(600)        # italic separately below
  "Nunito"            = @(800)
  "Roboto+Condensed"  = @(700)
}
$ITALICS = [ordered]@{
  "Playfair+Display" = @(400, 700)
  "Merriweather"     = @(400)
  "Lora"             = @(600)
}

function Get-Face([string]$family, [int]$weight, [bool]$italic) {
  $cssUrl = "https://fonts.googleapis.com/css2?family=$family`:wght@$weight" + $(if ($italic) { ";1" }) + "&display=swap"
  if ($italic) { $cssUrl = "https://fonts.googleapis.com/css2?family=$family`:ital,wght@1,$weight&display=swap" }
  $css = (Invoke-WebRequest -Uri $cssUrl -Headers @{ "User-Agent" = $UA } -UseBasicParsing).Content
  # Split into @font-face blocks; keep those ending in the "latin" subset comment block.
  $blocks = [regex]::Matches($css, "/\* ([a-z-]+) \*/\s*@font-face\s*\{[^}]+\}")
  $latin = $blocks | Where-Object { $_.Groups[1].Value -eq "latin" }
  if (-not $latin) { throw "no latin block for $family $weight" }
  $block = $latin[0].Value
  $url = [regex]::Match($block, "url\((https://[^)]+\.woff2)\)").Groups[1].Value
  if (-not $url) { throw "no woff2 url for $family $weight" }
  $fam = $family.Replace("+", "")
  $suffix = if ($italic) { "italic" } else { "normal" }
  $out = Join-Path $dest "$([char]::ToLower($fam[0]) + $fam.Substring(1))-latin-$weight-$suffix.woff2"
  Invoke-WebRequest -Uri $url -OutFile $out -Headers @{ "User-Agent" = $UA } -UseBasicParsing
  "{0} <- {1}" -f $out, $url
}

foreach ($f in $FAMILIES.Keys) {
  foreach ($w in $FAMILIES[$f]) { Get-Face $f $w $false }
}
foreach ($f in $ITALICS.Keys) {
  foreach ($w in $ITALICS[$f]) { Get-Face $f $w $true }
}
"DONE"
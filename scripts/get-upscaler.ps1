# Downloads Real-ESRGAN (ncnn-vulkan, Windows build) into ./bin. Runs on any Vulkan GPU (NVIDIA / AMD / Intel).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$exe = Join-Path $bin 'realesrgan-ncnn-vulkan.exe'
if (Test-Path $exe) { Write-Host "Already installed: $exe"; exit 0 }

$url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
$zip = Join-Path $env:TEMP 'realesrgan-ncnn-vulkan.zip'
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
New-Item -ItemType Directory -Force $bin | Out-Null
Expand-Archive -Path $zip -DestinationPath $bin -Force
Remove-Item $zip
# The release zip ships demo files the app never uses.
foreach ($f in 'onepiece_demo.mp4', 'input.jpg', 'input2.jpg') { Remove-Item (Join-Path $bin $f) -ErrorAction SilentlyContinue }
if (-not (Test-Path $exe)) { throw "Extraction finished but $exe is missing" }
Write-Host "Installed to $bin"

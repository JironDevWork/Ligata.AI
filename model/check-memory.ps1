# Where does llama-server's memory live? Run any time while it is running.
#   .\check-memory.ps1          -> one snapshot
#   .\check-memory.ps1 -Watch   -> refresh every 2 s (Ctrl+C to stop)
#   .\check-memory.ps1 -Json    -> one machine-readable snapshot (used by the benchmarks and the gateway)
param([switch]$Watch, [switch]$Json)

# "Shared" GPU memory is system RAM used by the GPU. llama.cpp legitimately pins a little
# (staging buffers). Clearly more than this limit means VRAM overflowed into system RAM.
$sharedLimitMB = 800

do {
  $p = Get-Process llama-server -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) {
    if ($Json) { '{"running":false}' } else { Write-Host 'llama-server is not running.' }
    exit 1
  }
  $cs = (Get-Counter '\GPU Process Memory(*)\Shared Usage', '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples |
        Where-Object { $_.InstanceName -match "pid_$($p.Id)_" }
  $ded = ($cs | Where-Object Path -match 'dedicated' | Measure-Object CookedValue -Sum).Sum / 1MB
  $sh  = ($cs | Where-Object Path -match 'shared'    | Measure-Object CookedValue -Sum).Sum / 1MB
  $gpu = (& nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits) -split ',\s*'
  if ($Json) {
    [ordered]@{ running = $true; pid = $p.Id; workingSetMB = [int]($p.WorkingSet64 / 1MB); privateMB = [int]($p.PrivateMemorySize64 / 1MB)
      processVramMB = [int]$ded; sharedRamMB = [int]$sh; gpuUsedMB = [int]$gpu[0]; gpuTotalMB = [int]$gpu[1]; spilling = ($sh -gt $sharedLimitMB) } | ConvertTo-Json -Compress
    exit 0
  }
  $line = '{0:HH:mm:ss}  RAM (working set) {1,6:N0} MB | private {2,6:N0} MB | VRAM {3,6:N0} MB (GPU total {4} / {5} MB) | GPU-shared RAM {6,5:N0} MB' -f (Get-Date), ($p.WorkingSet64 / 1MB), ($p.PrivateMemorySize64 / 1MB), $ded, $gpu[0], $gpu[1], $sh
  if ($sh -gt $sharedLimitMB) { Write-Host "$line  <-- SPILLING INTO SYSTEM RAM (lower the context)" -ForegroundColor Red }
  else { Write-Host $line }
  if ($Watch) { Start-Sleep 2 }
} while ($Watch)

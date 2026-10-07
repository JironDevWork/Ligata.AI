#!/usr/bin/env bash
# Development helper: rebuilds and restarts the Umbraco test host on :5310 with the support fixture,
# a fake reCAPTCHA verifier and the dev gateway on :1220 (key from .runtime/gateway-dev/created.txt).
set -e
cd "$(dirname "$0")/../Ligata.AI.Tests"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5310 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" || true
dotnet build -c Debug 2>&1 | grep -E " error |Build succeeded" | head -5
KEY=$(grep -o 'lai_[A-Za-z0-9_-]*' ${KEY_FILE:-../../.runtime/gateway-dev/created.txt})
# CONFIG_KEY=0 leaves the gateway address and key to the backoffice (the AI suite stores them through the UI).
if [ "${CONFIG_KEY:-1}" = "1" ]; then export LigataAI__ApiKey="$KEY" LigataAI__GatewayUrl=${GATEWAY:-http://127.0.0.1:1220}; fi
nohup dotnet run -c Debug --no-build -- --database ../../.runtime/ai-test.db --serve --fake-captcha --support-fixture --urls http://127.0.0.1:5310 "$@" > ../../.runtime/logs/host.log 2>&1 &
for i in $(seq 1 80); do
  sleep 3
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5310/api/ligata-ai/config | grep -q 200; then break; fi
  if grep -q "Unhandled exception" ../../.runtime/logs/host.log; then break; fi
done
grep -E "checks passed|Unhandled exception|FAILED" ../../.runtime/logs/host.log | head -5

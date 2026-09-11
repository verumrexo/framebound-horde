#!/bin/zsh
set -e
cd "$(dirname "$0")"

if [[ -x "./cloudflared" ]]; then
  cloudflared_bin="./cloudflared"
elif command -v cloudflared >/dev/null 2>&1; then
  cloudflared_bin="$(command -v cloudflared)"
else
  echo "cloudflared is missing. download it, unzip it, and put the cloudflared file beside this script."
  read "?press return to close..."
  exit 1
fi

npm run relay &
relay_pid=$!
trap 'kill $relay_pid 2>/dev/null || true' EXIT INT TERM
sleep 2
echo "copy the https://...trycloudflare.com address below and add ?relay=1"
"$cloudflared_bin" tunnel --url http://127.0.0.1:8787

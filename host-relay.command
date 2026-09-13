#!/bin/zsh
set -e -o pipefail
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

npm run build
node scripts/relay-server.mjs &
relay_pid=$!
trap 'kill $relay_pid 2>/dev/null || true' EXIT INT TERM
sleep 2
"$cloudflared_bin" tunnel --url http://127.0.0.1:8787 2>&1 | {
  tunnel_url=''
  tunnel_ready=0
  while IFS= read -r tunnel_line; do
    if [[ "$tunnel_line" =~ 'https://[a-z0-9-]+\.trycloudflare\.com' ]]; then
      tunnel_url="${MATCH}/?relay=1"
    fi
    if (( ! tunnel_ready )); then
      print -r -- "$tunnel_line"
    elif [[ "$tunnel_line" == *' ERR '* || "$tunnel_line" == *' WRN '* ]]; then
      print -r -- "$tunnel_line"
      print -r -- "$tunnel_url"
    fi
    if (( ! tunnel_ready )) && [[ -n "$tunnel_url" && "$tunnel_line" == *'Registered tunnel connection'* ]]; then
      tunnel_ready=1
      print
      if command -v pbcopy >/dev/null 2>&1 && print -rn -- "$tunnel_url" | pbcopy; then
        print -r -- 'link copied to clipboard // keep this terminal open'
      else
        print -r -- 'open this link on both computers // keep this terminal open'
      fi
      print -r -- "$tunnel_url"
    fi
  done
}

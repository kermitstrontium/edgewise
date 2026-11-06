#!/usr/bin/env bash
# Install Edgewise as a systemd user unit and expose it on the tailnet only:
#   https://frozen-wsl.tail50be60.ts.net:9451/   (never funnel)
set -euo pipefail
DIR="$HOME/ai-share/edgewise"
mkdir -p "$HOME/.config/systemd/user"
cp "$DIR/host/edgewise.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now edgewise.service
sleep 1
curl -s -o /dev/null -w 'local %{http_code}\n' http://127.0.0.1:8097/
tailscale serve --bg --https=9451 http://127.0.0.1:8097
tailscale serve status

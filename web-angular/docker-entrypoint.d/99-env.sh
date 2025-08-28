#!/usr/bin/env sh
set -eu
cat > /usr/share/nginx/html/env.js <<EOF
window.API_BASE = '${API_BASE:-}';
window.MAPBOX_ACCESS_TOKEN = '${MAPBOX_ACCESS_TOKEN:-}';
EOF

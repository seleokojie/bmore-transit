#!/usr/bin/env sh
set -eu
cat > /usr/share/nginx/html/env.js <<EOF
window.API_BASE = '${API_BASE:-}';
window.MAP_STYLE_URL = '${MAP_STYLE_URL:-}';
EOF

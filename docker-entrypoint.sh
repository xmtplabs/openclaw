#!/bin/sh
set -e

# If running as root (typical in Docker/Fly.io), fix volume ownership
# then drop to the unprivileged node user.
if [ "$(id -u)" = "0" ]; then
    # Fix ownership on the data/state directory if it exists
    if [ -d "/data" ]; then
        chown -R node:node /data
    fi
    exec gosu node "$@"
fi

# Already running as non-root (e.g. docker run --user node) — just exec
exec "$@"

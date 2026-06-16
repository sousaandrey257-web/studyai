#!/bin/sh
set -e

# Fix volume permissions — Railway mounts volumes as root.
# We chown the data dir to studyai before dropping privileges.
chown -R studyai:studyai /app/data 2>/dev/null || true

exec su-exec studyai "$@"

#!/usr/bin/env bash
# Convenience wrapper: loads DEMO_PASSWORD from apps/api/.env, then runs scripts/screens.mjs.
cd "$(dirname "$0")/.." || exit 1
export DEMO_PASSWORD="$(grep '^DEMO_PASSWORD=' apps/api/.env | cut -d= -f2- | tr -d '\r"')"
exec node scripts/screens.mjs "$@"

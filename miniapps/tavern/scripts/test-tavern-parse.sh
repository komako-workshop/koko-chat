#!/usr/bin/env bash
# Wrapper to run the Tavern parser tests with the @/ alias loader.
# See test-tavern-parse.mjs and test-loader.mjs for details.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node \
  --experimental-strip-types \
  --no-warnings=ExperimentalWarning \
  --import="data:text/javascript,import { register } from 'node:module'; import { pathToFileURL } from 'node:url'; register('$HERE/test-loader.mjs', pathToFileURL('$HERE/'));" \
  "$HERE/test-tavern-parse.mjs"

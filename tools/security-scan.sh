#!/usr/bin/env bash
# npm run scan: every security scanner, at pinned versions, the same in CI and here (docs/threat-model.md says what each
# door relies on). Installs the tools into .scan-tools/ (git-ignored) on first use: needs go >= 1.27, python3 and git.
# Each step fails the script on a finding that is not suppressed in the code with its reason.
set -euo pipefail
cd "$(dirname "$0")/.."
T="$PWD/${SCAN_TOOLS:-.scan-tools}"
mkdir -p "$T/bin"
export GOBIN="$T/bin" PATH="$T/bin:$PATH"
need() { [ -x "$T/bin/$1" ] || go install "$2"; }
need actionlint github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
need gitleaks github.com/zricethezav/gitleaks/v8@v8.30.1
need osv-scanner github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.6.0
if [ ! -x "$T/py/bin/shellcheck" ]; then python3 -m venv "$T/py" && "$T/py/bin/pip" install -q semgrep==1.178.0 zizmor==1.30.1 shellcheck-py==0.11.0.1; fi
export PATH="$T/py/bin:$PATH"   # actionlint runs shellcheck on every run: block (CI's runner has one; this pins it)
# the community rules at a fixed commit; the jQuery rules are left out: there is no jQuery here ($ is getElementById)
RULES_REV=a84ff9cc2453ca91d581380de4b8b3f272f6f4be
R="$T/semgrep-rules"
if [ "$(git -C "$R" rev-parse HEAD 2>/dev/null)" != "$RULES_REV" ]; then
  rm -rf "$R" && git init -q "$R" && git -C "$R" fetch -q --depth 1 https://github.com/semgrep/semgrep-rules "$RULES_REV" && git -C "$R" checkout -q FETCH_HEAD
  rm -rf "$R/javascript/jquery"
fi
step() { printf '\n== %s\n' "$1"; }

step 'actionlint: the workflows'
actionlint .github/workflows/*.yml
step 'zizmor: workflow security (pinned actions, permissions, injection)'
if [ -n "${CI:-}" ] && [ -n "${GH_TOKEN:-}" ]; then "$T/py/bin/zizmor" .github/workflows; else "$T/py/bin/zizmor" --offline .github/workflows; fi
step 'gitleaks: secrets in the whole git history'
gitleaks git . --redact --no-banner
step 'osv-scanner: known vulnerable packages in package-lock.json'
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY="$T/osvdb" osv-scanner scan source --offline-vulnerabilities --download-offline-databases --lockfile package-lock.json --lockfile tools/observatory/package-lock.json
step 'npm audit: the same from the npm registry'
npm audit --audit-level=low
npm audit --audit-level=low --prefix tools/observatory
step 'semgrep: the code'
"$T/py/bin/semgrep" --metrics=off --error --quiet --config "$R/javascript" --config "$R/generic" --config "$R/yaml/github-actions" --config "$R/html" \
  js server tools index.html .github/workflows
step 'CSP Evaluator: the page policies'
node tools/check-csp.mjs
printf '\nsecurity-scan: every scanner passed\n'

#!/usr/bin/env bash
# Keeps the fork on the newest stable upstream tag (ADR-0001).
#
#   fork-rebase.sh base    print the stable upstream tag HEAD is built on
#   fork-rebase.sh rebase  rebase HEAD onto the newest stable tag, if newer
#
# Expects upstream's tags to be fetched already. `rebase` writes `base` and
# `rebased` to $GITHUB_OUTPUT when it's set. On a conflict it aborts the
# rebase and exits non-zero, leaving HEAD untouched.
set -euo pipefail

stable_tags() {
  grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V || true
}

base_tag() {
  git tag --merged HEAD --list 'v*' | stable_tags | tail -n1
}

latest_tag() {
  git tag --list 'v*' | stable_tags | tail -n1
}

output() {
  echo "$1=$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$1=$2" >>"$GITHUB_OUTPUT"
  fi
}

is_newer() {
  [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" == "$1" ]]
}

cmd_base() {
  local base
  base=$(base_tag)
  if [[ -z "$base" ]]; then
    echo "No stable v* tag is reachable from HEAD; fetch upstream's tags first." >&2
    exit 1
  fi
  echo "$base"
}

cmd_rebase() {
  local base latest
  base=$(cmd_base)
  latest=$(latest_tag)

  if ! is_newer "$latest" "$base"; then
    echo "Already on the newest stable tag ($base)."
    output base "$base"
    output rebased false
    return
  fi

  echo "Rebasing from $base onto $latest."
  if ! git rebase --onto "$latest" "$base"; then
    git rebase --abort || true
    echo "::error::Rebase onto $latest conflicts. Nothing was pushed; rebase by hand."
    exit 1
  fi
  output base "$latest"
  output rebased true
}

case "${1:-}" in
  base) cmd_base ;;
  rebase) cmd_rebase ;;
  *)
    echo "usage: $0 base|rebase" >&2
    exit 2
    ;;
esac

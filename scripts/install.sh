#!/usr/bin/env bash
set -euo pipefail

die() { printf 'html-view install: %s\n' "$*" >&2; exit 1; }
usage='Usage: bash install.sh
Clones into ~/.agents/skill-lib/html-view-skill and links html-view in
~/.agents/skills and ~/.claude/skills. Existing entries are not replaced.'
case ${1:-} in
  -h|--help) printf '%s\n' "$usage"; exit 0 ;;
esac
[[ $# -eq 0 ]] || die "$usage"
[[ ${HOME:-} == /* ]] || die 'HOME must be an absolute path.'
command -v git >/dev/null || die 'Install Git and retry.'

url=https://github.com/fengwk/html-view-skill.git
repo="$HOME/.agents/skill-lib/html-view-skill"
skill="$repo/skills/html-view"
entry_exists() { [[ -e $1 || -L $1 ]]; }
bad_checkout() { die "Cannot use $repo: $1. Repair it or move it aside and rerun; it was not replaced."; }

if ! entry_exists "$repo"; then
  mkdir -p "${repo%/*}"
  git clone -- "$url" "$repo" || die "Could not clone into $repo. Check the Git error above and retry."
fi

[[ -d $repo && -e $repo/.git ]] || bad_checkout 'not a Git checkout'
inside=$(git -C "$repo" rev-parse --is-inside-work-tree) && [[ $inside == true ]] || bad_checkout 'not a Git worktree'
prefix=$(git -C "$repo" rev-parse --show-prefix) && [[ -z $prefix ]] || bad_checkout 'not a checkout root'
git -C "$repo" rev-parse --verify --quiet 'HEAD^{commit}' >/dev/null || bad_checkout 'HEAD is missing or invalid'
origin=$(git -C "$repo" config --local --get remote.origin.url) || bad_checkout 'missing origin URL'
# Compare the configured URL, not the rewritten transport URL used by Git mirrors.
shopt -s nocasematch
case ${origin%/} in
  https://github.com/fengwk/html-view-skill|https://github.com/fengwk/html-view-skill.git|\
  git@github.com:fengwk/html-view-skill|git@github.com:fengwk/html-view-skill.git|\
  ssh://git@github.com/fengwk/html-view-skill|ssh://git@github.com/fengwk/html-view-skill.git) ;;
  *) bad_checkout 'origin is not the HTML View project' ;;
esac
[[ -f $skill/SKILL.md && -f $skill/scripts/htmlview && -f $skill/scripts/src/cli/main.mjs ]] || bad_checkout 'skill files are missing'
git -C "$repo" diff --quiet --no-renames --diff-filter=D HEAD -- skills/html-view || bad_checkout 'tracked skill files are missing or Git could not read the checkout'
printf 'Using checkout: %s\n' "$repo"

for dir in "$HOME/.agents/skills" "$HOME/.claude/skills"; do
  target="$dir/html-view"
  if entry_exists "$target"; then
    printf 'Skipped existing entry (unchanged): %s\n' "$target"
    continue
  fi
  mkdir -p "$dir"
  # Give ln the parent directory so it never descends into an existing html-view entry.
  ln -s "$skill" "$dir/" || die "Could not link $target. Check the destination and rerun."
  printf 'Linked: %s -> %s\n' "$target" "$skill"
done

#!/usr/bin/env bash
# ABOUTME: Runs a non-interactive diagnostic against the OMP lab Docker image.
# ABOUTME: Verifies the image OS, OMP entrypoint, and checkpoint extension dependency load path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

IMAGE="${1:-${OMP_LAB_SKILLED_IMAGE}}"

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker not found; cannot inspect OMP lab image\n' >&2
  exit 127
fi

exec docker run --rm --entrypoint bash "${IMAGE}" -c '
set -euo pipefail

printf "image=%s\n" "'"${IMAGE}"'"
grep "^PRETTY_NAME=" /etc/os-release
ldd --version >/tmp/ldd-version
sed -n "1p" /tmp/ldd-version
printf "user=%s\n" "$(whoami)"
omp --help >/tmp/omp-help
printf "omp=%s\n" "$(sed -n "1p" /tmp/omp-help)"

cd /checkpoint-src
printf "checkpoint_pi_ai=%s\n" "$(node -p "require(\"./node_modules/@oh-my-pi/pi-ai/package.json\").version")"
printf "checkpoint_pi_natives=%s\n" "$(node -p "require(\"./node_modules/@oh-my-pi/pi-natives/package.json\").version")"
bun -e "await import(\"@oh-my-pi/pi-ai\"); console.log(\"checkpoint_pi_ai_import=ok\")"
test -r /checkpoint-src/src/omp_extension/db_specialist_extension.ts
test -r /checkpoint-skills/db-investigation/SKILL.md
'

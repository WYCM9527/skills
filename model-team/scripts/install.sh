#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/install.sh [options]

Options:
  --user            安装到用户目录 ${CURSOR_CONFIG_DIR:-~/.cursor}/（默认）
  --project <dir>   安装到指定项目目录 <dir>/.cursor/（适用于 Cursor CLI 或单项目）
  --agents-only     仅安装三个配套子代理（技能已通过 npx skills 等方式安装时使用）
  -h, --help        显示帮助
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_SRC_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

SCOPE="user"
PROJECT_DIR=""
AGENTS_ONLY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user)
      SCOPE="user"
      shift
      ;;
    --project)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "Error: --project 需要传入目标项目目录" >&2
        exit 1
      fi
      SCOPE="project"
      PROJECT_DIR="$2"
      shift 2
      ;;
    --agents-only)
      AGENTS_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: 未知参数 $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "${SCOPE}" = "project" ]; then
  if [ ! -d "${PROJECT_DIR}" ]; then
    echo "Error: 项目目录不存在: ${PROJECT_DIR}" >&2
    exit 1
  fi
  PROJECT_ABS="$(cd "${PROJECT_DIR}" && pwd -P)"
  CURSOR_ROOT="${PROJECT_ABS}/.cursor"
else
  CURSOR_ROOT="${CURSOR_CONFIG_DIR:-${HOME}/.cursor}"
fi

AGENTS_DST_DIR="${CURSOR_ROOT}/agents"
SKILL_DST_DIR="${CURSOR_ROOT}/skills/model-team"

mkdir -p "${AGENTS_DST_DIR}"
for agent_file in advisor.md backend-worker.md browser-worker.md; do
  cp "${SKILL_SRC_DIR}/assets/agents/${agent_file}" "${AGENTS_DST_DIR}/${agent_file}"
done
echo "Installed subagents -> ${AGENTS_DST_DIR}/{advisor,backend-worker,browser-worker}.md"

if [ "${AGENTS_ONLY}" -eq 0 ]; then
  mkdir -p "${SKILL_DST_DIR}"
  SKILL_DST_ABS="$(cd "${SKILL_DST_DIR}" && pwd -P)"
  if [ "${SKILL_SRC_DIR}" != "${SKILL_DST_ABS}" ]; then
    cp -R "${SKILL_SRC_DIR}/SKILL.md" "${SKILL_SRC_DIR}/README.md" "${SKILL_SRC_DIR}/assets" "${SKILL_SRC_DIR}/scripts" "${SKILL_DST_DIR}/"
    chmod +x "${SKILL_DST_DIR}/scripts/install.sh"
    echo "Installed skill     -> ${SKILL_DST_DIR}"
  else
    echo "Skill already in    -> ${SKILL_DST_DIR} (skipped copy)"
  fi
fi

echo "Done. 若当前已打开远程窗口或旧对话，请执行 Reload Window 并新开一个对话使子代理生效。"

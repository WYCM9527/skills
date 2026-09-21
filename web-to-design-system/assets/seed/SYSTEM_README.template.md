# {{NAME}} Design System

**{{DESCRIPTION}}**

版本 **{{VERSION}}** · Core {{TOKEN_COUNT}} 个 token{{THEME_SUMMARY}} · 由 [web-to-design-system](https://github.com/WYCM9527/skills/tree/main/web-to-design-system) 从 {{SOURCES}} 实测提炼（{{DATE}}）· 变更见 [CHANGELOG](seeds/{{SEED_NAME}}/CHANGELOG.md)

---

## 目录

```text
{{ID}}/
├── README.md                # 本文件：系统概览、状态、接入入口
└── seeds/{{SEED_NAME}}/     # 分发单元：design-system/（token · DESIGN · AUDIT · themes）· bridge/ · templates/ · design-system.json
```

以后可以像 Citrine 一样加 `previews/`（预览页）、`testbed/`（实测项目）、`tools/`（验收工具）；在此之前它只是一套 token + 规则 + 基础桥接。

## 状态

- 来源与证据：`seeds/{{SEED_NAME}}/design-system/AUDIT.md`——哪些是实测、哪些是推断、哪些还缺。
- 规则：`seeds/{{SEED_NAME}}/design-system/DESIGN.md`。
- 桥接：{{BRIDGE_STATUS}}
- 待办：{{TODO_LINE}}

## 接入

```bash
git clone --depth 1 https://github.com/{{REPO}}.git /tmp/ds
mkdir -p .cursor/skills && cp -R /tmp/ds/design-system-adopter .cursor/skills/
mkdir -p vendor && cp -R /tmp/ds/{{PATH}} vendor/{{ID}}
node .cursor/skills/design-system-adopter/scripts/ds.mjs init --system {{ID}} --stack {{DEFAULT_STACK}}
```

然后 steward `validate-system → build-tokens → guard`，再对 Agent 说「用 {{NAME}} 起项目」。升级走 `ds.mjs status / upgrade`（按 tag `{{ID}}-vX.Y.Z`）。

## 发版

改 `seeds/{{SEED_NAME}}/design-system.json` 与 `package.json` 版本、写 CHANGELOG、更新本文件与仓库根 README 的版本行，`node scripts/check-versions.mjs --system {{ID}}` 通过后打 tag `{{ID}}-vX.Y.Z` 推送，`release.yml` 自动建 Release。

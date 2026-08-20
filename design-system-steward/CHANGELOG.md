# Changelog

## 0.2.0 — 2026-08-20

- Adds Core plus inheritable scoped design-rule governance, called “局部规范／生效范围” in Chinese documentation.
- Adds the canonical `scope-map.json` registry, scoped documentation, boundary validation, and scoped CSS build outputs.
- Adds `apply --scope <id>` for confirmed scope scaffolding and explicit `integrate --scope <id>` with a read-only preview followed by a second confirmation before any UI edit.
- Distinguishes scopes from themes, component exceptions, drift, and independent-design-system candidates.
- Builds Core and each Scope independently with Style Dictionary `5.5.2`, preserving aliases while preventing sibling-scope input collisions.
- Expands audit, experiment, guard, fixtures, installation guidance, and Chinese references for scoped workflows.

## 0.1.0 — 2026-08-20

- First public Git release of the portable `design-system-steward` Agent Skill.
- Adds evidence-led audit, proposal, confirmed scaffold, experiment, and guard workflows.
- Adds a DTCG 2025.10 CSS profile with deterministic Style Dictionary output.
- Adds explicit-only install adapters for Codex, Claude Code, and Cursor.

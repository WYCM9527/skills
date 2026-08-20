# Changelog

## 0.3.0 — 2026-08-20

- Adds a confirmed Theme governance path: Core represents the approved default mode; `theme-map.json` registers activation and managed modes; Theme directories store only DTCG deltas relative to Core.
- Adds explicit `apply --theme <id>` and `integrate --theme <id>` documentation, including separate write and second-integration confirmations. v0.3 does not create Theme switches or automatic Scope × Theme runtime combinations.
- Separates explicit Steward work from ordinary coding: an approved, short project-rule reference lets coding Agents consume the system; new or revised reusable visual decisions return to proposal and approval first.
- Clarifies that legacy sources remain temporary evidence before confirmed migration, while managed values have one DTCG source of truth. Ordinary content changes and one-off Drift do not automatically expand the system.
- Refactors Skill guidance for progressive disclosure, moving Theme and long-term governance details into focused references.

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

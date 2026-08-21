# Changelog

## 0.5.0 — 2026-08-21

- Adds a three-phase `migrate` mode for unifying legacy code onto approved tokens: `adopt` bridges legacy CSS variable definitions, `replace` rewrites matching stylesheet literals and Tailwind arbitrary values, `settle` turns leftovers into merge/promote/exempt decisions. Plans are read-only; `--apply` requires a clean git worktree and writes a `MIGRATION.md` report with per-file diffs and rollback commands.
- Replacement targets are Semantic-first: primitive-only or ambiguous value hits are never rewritten silently, and JS/TS inline literals are reported but untouched. Color matching normalizes hex case, short hex, and rgb()/rgba(); rem→px conversion is opt-in via `--rem-in-px`.
- Adds `design-system/exemptions.json`, a reasoned registry of intentionally unmanaged paths and values. Audit, `guard --changed`, and migrate silently skip registered entries; guard reports stale entries whose target files were removed, without any review-date nagging.
- Adds a read-only `status` mode: token/scope/theme counts, remaining bridgeable and replaceable literals, pending decisions, adoption percentage, and the single best next step.
- Questionnaires now open with a conservative/recommended/aggressive preset choice; remaining questions use the preset's defaults and only surface on evidence conflicts. Setup now ends by telling the user their current state and the migrate/status next steps.
- Rewrites the README usage section as a lifecycle journey (day one → first week → daily → anytime) and documents the "adopt or formally exempt, no anonymous leftovers" governance principle.

## 0.4.0 — 2026-08-21

- Adds a user-facing communication contract and a `setup` mode that merges first-run gates into one questionnaire with recommended answers. Governance gates are unchanged.
- Fixes Theme scaffolding so `THEME.md` keeps status and reason, and activation labels use the real Theme id.
- Tightens audit Scope and Theme evidence so global stylesheets, ordinary page literals, and `highlight`/`darken` filenames are not promoted as candidates.
- Classifies everyday Chinese content and beautify requests more accurately in `change`, and distinguishes an empty scaffold from a broken system.
- Accepts a DTCG `hex` field on structured sRGB colors, checks it against components, and prefers that hex in generated CSS.
- Writes `disable-model-invocation: true` for every host, localizes validator messages, and lists global stylesheet entry candidates in Scope integration previews.

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

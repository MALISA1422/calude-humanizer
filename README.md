# Humanizer (Claude Code plugin)

Three agents rewrite AI-written text so it reads as if a person wrote it, then
check every rewrite against the original so facts and figures survive.

| Pass | Agent | Product |
| --- | --- | --- |
| 1 | `humanizer:voice-analyst` | a brief: the machine-written tells, the facts to keep, the moves to make |
| 2 | `humanizer:rewriter` | one section restyled |
| 3 | `humanizer:editor` | final text plus a change report |

The prompts forbid inventing content. The editor is told to delete anything the
rewriter invented, and a deterministic check reports figures that disappeared or
appeared, plus the overall length drift.

## Install

**For one session (no setup):**

```bash
claude --plugin-dir /path/to/claude-humanizer
```

**For everyday use, through the local marketplace this bundle ships:**

```bash
claude plugin marketplace add /path/to/claude-humanizer
claude plugin install humanizer@humanizer-local
```

Restart the session after installing. Check it with `/plugin` — the plugin
appears as `humanizer`, with its skill, command, and three agents listed. To
update later, `claude plugin update humanizer@humanizer-local`.

## Use it

Just ask:

> humanize this essay — humanize essay.md

> rewrite these notes so they don't read like AI, keep it academic

Or call the command:

```text
/humanizer:humanize essay.md
```

Options you can say in the same breath: tone (`academic`, `professional`,
`casual`, `journalistic`, or match the source) and intensity (`light`,
`balanced`, `strong`).

The result is written to `<name>.humanized.md` beside the source. The source
file is never modified.

## What it will not do

- It will not invent facts, examples, or statistics to look more specific.
- It cannot guarantee any AI detector's verdict. It changes how the prose
  reads. Detectors also flag human writing.
- It does not handle tables, code blocks, or footnotes specially: they pass
  through as prose and may need a manual check afterward.

## Layout

```text
.claude-plugin/plugin.json   manifest
agents/voice-analyst.md      pass 1, read-only
agents/rewriter.md           pass 2
agents/editor.md             pass 3
skills/humanize/SKILL.md     the workflow Claude follows
commands/humanize.md         /humanizer:humanize
scripts/sections.mjs         section planning, sampling, figure checks
tests/                       structure and script checks
```

## Checks

```bash
node tests/validate.mjs        # manifest, frontmatter, cross-references
node tests/sections.test.mjs   # section planning, sampling, figure diffs
```

`tests/validate.mjs` stands in for `claude plugin validate`: it applies the
manifest rules from the plugin reference (kebab-case name, no reserved
first-party name, `./` component paths inside the plugin, frontmatter on every
component) and cross-checks that the skill names agents that exist. On Claude
Code 2.1.123 the built-in command printed nothing and exited 0 even for a
deliberately broken manifest, so it could not be used as evidence.

## License

MIT. Copyright (c) 2026 The Humanizer authors.

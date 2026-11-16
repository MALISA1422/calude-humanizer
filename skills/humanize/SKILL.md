---
name: humanize
description: Rewrite AI-written or model-drafted text so it reads as if a person wrote it, without changing the facts. Use when the user asks to humanize, restyle, de-slop, or make less AI-sounding a document, essay, assignment, report, cover letter, or article. Runs three agents — voice-analyst, rewriter, editor — section by section, and verifies the result against the original.
---

# Humanize a document

Three agents work in order on the same text. Never invent content at any pass:
the pipeline changes how the prose reads, never what it says.

| Pass | Agent (Task `subagent_type`) | Product |
| --- | --- | --- |
| 1 | `humanizer:voice-analyst` | a brief: the machine-written tells, the facts to keep, the moves to make |
| 2 | `humanizer:rewriter` | one section restyled |
| 3 | `humanizer:editor` | final text plus a change report |

## 0. Establish the input

- **Arguments:** `$ARGUMENTS` may hold a file path, pasted text, or empty. If
  empty, ask for the text or path. If it holds a path, read it with the Read
  tool.
- **Destination:** for a file, write the result to `<basename>.humanized.md`
  beside the source. Never overwrite the source unless the user explicitly asks.
  For pasted text, return it in the reply and offer to save it.
- **Settings** (defaults are fine; do not interrogate the user):
  - tone — `match` keeps the source register; also `academic`, `professional`,
    `casual`, `journalistic`
  - intensity — `light` (fix tells only), `balanced` (default), `strong` (may
    restructure paragraphs)
  - any constraint the user gave, such as an audience or a word limit

## 1. Plan the sections

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sections.mjs" plan <path> --max 6000
```

This prints JSON: the total character count and an array of `sections`, each
with its index, size, and text. Headings always open a section. If `node` is
unavailable, split the document yourself on blank lines into chunks of at most
6000 characters and start a new chunk at every heading.

For a long document, sample the analyst's input instead of the whole thing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sections.mjs" sample <path> --max 18000
```

## 2. Pass 1 — analyst

Call the Task tool once with `subagent_type: humanizer:voice-analyst` and give
it the whole document (or the sample). It returns the brief. Keep the entire
brief; both later passes receive it.

If the document was sampled, say so when you report back.

## 3. Pass 2 and 3 — per section

For each section, in order:

1. Task with `subagent_type: humanizer:rewriter`, giving it: the brief, the
   tone instruction, the intensity instruction, the previous section's last
   paragraph (for continuity, marked "do not rewrite"), the next section's
   first sentence (marked "do not repeat"), and the section text. It returns
   only the rewritten section.
2. Task with `subagent_type: humanizer:editor`, giving it: the brief, the
   source section, the draft, and the intensity instruction. It returns
   `=== FINAL ===` text plus a `=== REPORT ===`.
3. Extract the FINAL text. Keep every report line, deduplicated, for the
   summary.

Do not skip the editor, even when the draft looks good: it is the pass that
puts dropped facts back and removes anything the rewriter invented.

If a section's rewrite comes back at less than 40% of its source length, use
the source section as the draft instead and note it.

## 4. Assemble and verify

Join the sections with blank lines (a single space where a section was a
sentence-level split of one paragraph).

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sections.mjs" check --source <source> --final <result>
```

This prints JSON: `droppedFigures`, `addedFigures`, `sourceChars`,
`finalChars`, and `driftPercent`. Report both figure lists when they are not
empty; they are hints to check, not verdicts. A drift beyond ±25% means the
rewrite cut or padded substance — say so.

Then write the result to its destination with the Write tool.

## 5. Report back

Keep it short:

- the file you wrote, or the text for pasted input
- what changed — two to five editor report lines, not all of them
- anything from the verification step worth a look: dropped or added figures,
  large drift, sections that kept their original text
- the honest caveat, once: this changes how the prose reads. It cannot
  guarantee any particular AI detector's verdict, and detectors also flag
  human writing.

## Do not

- Do not ask the analyst, rewriter, or editor to evade a detector; they are
  editing for voice, and any instruction to beat a detector only invites
  fabrication.
- Do not invent facts to sound more specific. Specificity comes from the
  source.
- Do not run the three passes in parallel on the same section; the editor
  depends on the rewriter's output.

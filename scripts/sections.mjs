#!/usr/bin/env node
/**
 * Deterministic helpers for the humanize workflow.
 *
 *   node sections.mjs plan   <file> [--max 6000]
 *   node sections.mjs sample <file> [--max 18000]
 *   node sections.mjs check  --source <file> --final <file>
 *
 * `plan` splits a document into model-sized sections and prints them as JSON,
 * so the workflow hands each pass an exact section instead of re-deriving the
 * split by eye. `sample` returns the head, middle, and tail of a long document
 * for the analyst. `check` reports figures that disappeared or appeared and the
 * overall length drift. No dependencies; exits non-zero on usage errors.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ATX_HEADING = /^\s{0,3}#{1,6}\s+\S/
const SETEXT_UNDERLINE = /^\s{0,3}(?:={3,}|-{3,})\s*$/

/** Read one option value from argv. */
function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1) return fallback
  const value = process.argv[at + 1]
  if (value === undefined) fail(`--${name} needs a value`)
  return value
}

/** Print a usage error and exit. */
function fail(message) {
  console.error(`sections: ${message}`)
  process.exit(1)
}

/** Read a file or exit with a clear message. A leading BOM is dropped. */
function read(path) {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`)
  }
}

/** Treat a block as a heading so a section title never ends up last in a chunk. */
function isHeading(block) {
  const lines = block.split('\n')
  if (ATX_HEADING.test(lines[0] ?? '')) return true
  return lines.length > 1 && lines[0].trim() !== '' && SETEXT_UNDERLINE.test(lines[1])
}

/** Split into paragraph blocks plus the separator that joins them. */
function blocks(text) {
  const parts = text
    .split(/\n{2,}/)
    .map(block => block.replace(/\s+$/, ''))
    .filter(block => block.trim() !== '')
  return { parts, separator: /\n{2,}/.test(text) ? '\n\n' : '\n' }
}

/** Split one oversized paragraph on sentence boundaries. */
function splitLong(block, limit) {
  const sentences = block.match(/[^.!?\n]+(?:[.!?]+["')\]]*\s*)?/g) ?? [block]
  const pieces = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      if (current !== '') {
        pieces.push(current.trim())
        current = ''
      }
      for (let offset = 0; offset < sentence.length; offset += limit) {
        pieces.push(sentence.slice(offset, offset + limit).trim())
      }
      continue
    }
    if (current !== '' && current.length + sentence.length > limit) {
      pieces.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim() !== '') pieces.push(current.trim())
  return pieces.filter(piece => piece !== '')
}

/** Group blocks into sections no larger than the limit, headings opening one. */
function plan(text, limit) {
  const { parts, separator } = blocks(text)
  const sections = []
  let current = []
  let size = 0
  const flush = () => {
    if (current.length === 0) return
    sections.push({ text: current.join(separator), sep: separator })
    current = []
    size = 0
  }

  for (const block of parts) {
    if (isHeading(block) && current.length > 0) flush()
    if (block.length > limit) {
      flush()
      const pieces = splitLong(block, limit)
      pieces.forEach((piece, index) => {
        sections.push({ text: piece, sep: index === pieces.length - 1 ? separator : ' ' })
      })
      continue
    }
    if (current.length > 0 && size + separator.length + block.length > limit) flush()
    current.push(block)
    size += (current.length === 1 ? 0 : separator.length) + block.length
  }
  flush()
  return sections.length > 0 ? sections : [{ text: text.trim(), sep: '' }]
}

/** Head, middle, and tail of a long document. */
function sample(text, budget) {
  if (text.length <= budget) return { text, sampled: false }
  const head = Math.floor(budget * 0.45)
  const middle = Math.floor(budget * 0.2)
  const tail = budget - head - middle
  const at = Math.max(head, Math.floor((text.length - middle) / 2))
  return {
    text: [
      text.slice(0, head).trim(),
      '[… document continues …]',
      text.slice(at, at + middle).trim(),
      '[… document continues …]',
      text.slice(Math.max(0, text.length - tail)).trim(),
    ].join('\n\n'),
    sampled: true,
  }
}

/** Numeric mentions, normalized, in first-seen order. */
function figures(text) {
  const found = new Set()
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*\s?(?:%|percent)?/gi)) {
    found.add(match[0].replace(/\s+/g, '').toLowerCase())
  }
  return found
}

/** Figures in `a` missing from `b`. */
function diffFigures(a, b) {
  const inB = figures(b)
  return [...figures(a)].filter(token => !inB.has(token)).slice(0, 20)
}

export { plan, sample, blocks, splitLong, figures, diffFigures, isHeading }

/** Run the command line interface. */
function main() {
  const command = process.argv[2]
  const target = process.argv[3]

  if (command === 'plan') {
    if (target === undefined) fail('plan needs a file path')
    const text = read(target)
    const limit = Number(option('max', 6000))
    if (!Number.isInteger(limit) || limit <= 0) fail('--max must be a positive integer')
    const sections = plan(text, limit)
    console.log(JSON.stringify({
      file: target,
      sourceChars: text.length,
      sectionCount: sections.length,
      sections: sections.map((section, index) => ({
        index: index + 1,
        chars: section.text.length,
        joinAfter: section.sep,
        text: section.text,
      })),
    }, null, 2))
  } else if (command === 'sample') {
    if (target === undefined) fail('sample needs a file path')
    const text = read(target)
    const budget = Number(option('max', 18000))
    if (!Number.isInteger(budget) || budget <= 0) fail('--max must be a positive integer')
    const result = sample(text, budget)
    console.log(JSON.stringify({
      file: target,
      sourceChars: text.length,
      sampled: result.sampled,
      chars: result.text.length,
      text: result.text,
    }, null, 2))
  } else if (command === 'check') {
    const sourcePath = option('source')
    const finalPath = option('final')
    if (sourcePath === undefined || finalPath === undefined) fail('check needs --source <file> and --final <file>')
    const source = read(sourcePath)
    const final = read(finalPath)
    const drift = source.length === 0 ? 0 : ((final.length - source.length) / source.length) * 100
    console.log(JSON.stringify({
      sourceChars: source.length,
      finalChars: final.length,
      driftPercent: Number(drift.toFixed(1)),
      droppedFigures: diffFigures(source, final),
      addedFigures: diffFigures(final, source),
    }, null, 2))
  } else if (command === '-h' || command === '--help' || command === undefined) {
    console.log(`usage:
  sections.mjs plan   <file> [--max 6000]    split a document into sections (JSON)
  sections.mjs sample <file> [--max 18000]   head/middle/tail digest for the analyst
  sections.mjs check  --source <file> --final <file>
                                             dropped/added figures and length drift`)
  } else {
    fail(`unknown command "${command}"; try --help`)
  }
}

// Importable for tests; runs as a CLI only when invoked directly.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

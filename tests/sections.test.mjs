/**
 * Behavioural checks for scripts/sections.mjs, which the humanize workflow
 * calls. Imported directly, so no subprocess is spawned.
 *
 * Run: node tests/sections.test.mjs
 */

import { blocks, diffFigures, figures, plan, sample, splitLong } from '../scripts/sections.mjs'

let checks = 0
let failures = 0

function check(label, actual, expected) {
  checks++
  if (actual !== expected) {
    failures++
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function ok(label, value) {
  checks++
  if (!value) {
    failures++
    console.error(`FAIL ${label}`)
  }
}

const DOC = [
  '# Quarterly logistics review',
  '',
  'The logistics function has undertaken a comprehensive review of its operations. It is important to note that the results are robust.',
  '',
  'In conclusion, the logistics function will continue to review its operations.',
].join('\n')

const LONG = Array.from({ length: 6 }, (_, index) =>
  `Paragraph ${index + 1}. ${'The vendor reported steady throughput across the quarter. '.repeat(16)}`).join('\n\n')

/* Blocks and separators. */

{
  const { parts, separator } = blocks(DOC)
  check('block count', parts.length, 3)
  check('separator', separator, '\n\n')
  ok('heading is the first block', parts[0].startsWith('# Quarterly'))
}

/* Planning. */

{
  const sections = plan(DOC, 6000)
  check('small document is one section', sections.length, 1)
  ok('text is preserved', sections[0].text.includes('comprehensive review'))
}

{
  const sections = plan(LONG, 900)
  ok('long document splits', sections.length > 3)
  let biggest = 0
  for (const section of sections) biggest = Math.max(biggest, section.text.length)
  ok('no section exceeds the limit by more than one word', biggest <= 900 + 60)
  const rebuilt = sections.map(section => section.text).join('\n\n')
  check('all paragraphs survive planning', (rebuilt.match(/Paragraph \d\./g) ?? []).length, 6)
}

{
  const sections = plan('# Title\n\n' + 'Body sentence here. '.repeat(120), 400)
  ok('a heading always opens a section', sections[0].text.startsWith('# Title'))
  ok('the body continues in a later section', sections.length > 1)
}

{
  const sections = plan('', 100)
  check('empty input yields one section', sections.length, 1)
}

/* Oversized single paragraph. */

{
  const pieces = splitLong('One. Two. Three. '.repeat(40), 100)
  ok('long paragraph is split', pieces.length > 1)
  for (const piece of pieces) ok('piece fits the limit', piece.length <= 100)
}

/* Sampling. */

{
  const short = sample('abc', 100)
  check('short text is not sampled', short.sampled, false)
  check('short text is returned whole', short.text, 'abc')

  const long = sample('x'.repeat(500), 100)
  check('long text is sampled', long.sampled, true)
  ok('sample marks the gaps', long.text.includes('document continues'))
  ok('sample respects the budget', long.text.length <= 100 + 60)
}

/* Figures. */

{
  ok('figures are collected', figures('grew 12% and 48 units, not 12%  again').size === 2)
  check('dropped figure found', diffFigures('grew 12% to 48', 'grew 12%').join(','), '48')
  check('no drop when figure kept', diffFigures('grew 12%', 'it grew by 12% in total').length, 0)
  check('added figure found', diffFigures('grew 12% to 51', 'grew 12%').join(','), '51')
  check('percent and bare number are distinct', diffFigures('23%', '23').join(','), '23%')
}

console.log(`\n${checks} checks, ${failures} failure(s)`)
if (failures > 0) process.exitCode = 1

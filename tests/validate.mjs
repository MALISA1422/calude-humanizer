/**
 * Structural checks for the humanizer plugin, standing in for
 * `claude plugin validate` where that command is unavailable: it loads the
 * manifest, verifies every component location and frontmatter block, and
 * cross-checks that the skill names agents that exist.
 *
 * Run: node tests/validate.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
let failures = 0

function ok(label, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.error(`FAIL ${label}${detail === '' ? '' : `: ${detail}`}`)
  }
}

function fail(label, detail) {
  ok(label, false, detail)
}

/** Read a file relative to the plugin root. */
function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

/** Minimal YAML front-matter reader: `key: value` pairs, quoted or bare. */
function frontmatter(text, label) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\uFEFF/, ''))
  if (match === null) return fail(`${label} has frontmatter`, 'no --- block')
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair === null) continue
    fields[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

/* ---------------------------------------------------------------- manifest */

const manifestPath = join(root, '.claude-plugin', 'plugin.json')
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  ok('manifest parses', true)
} catch (error) {
  fail('manifest parses', error.message)
  manifest = {}
}

const name = manifest.name
ok('manifest has a name', typeof name === 'string' && name.length > 0)
ok('name is kebab-case', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? ''), name)
ok('name avoids reserved prefixes', !/^(claude|anthropic|anthropics|cc-plugin)-/.test(name ?? ''), name)
ok('name avoids reserved words', !['claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods'].includes(name ?? ''))
ok('name does not read as a first-party plugin', !/\b(claude|anthropic|anthropics)\b/.test((name ?? '').replace(/-/g, ' ')))
ok('manifest has a version', typeof manifest.version === 'string')
ok('manifest has a description', typeof manifest.description === 'string' && manifest.description.length > 20)
ok('manifest description fits 350 characters', (manifest.description ?? '').length <= 350, `${(manifest.description ?? '').length} chars`)
ok('manifest has an author name', typeof manifest.author?.name === 'string' && manifest.author.name.length > 0)
ok('license is an SPDX id', manifest.license === 'MIT')
ok('keywords are strings', Array.isArray(manifest.keywords) && manifest.keywords.every(k => typeof k === 'string'))
ok('homepage, if present, parses as a URL', manifest.homepage === undefined || URL.canParse(manifest.homepage))

const KNOWN_FIELDS = new Set(['name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository',
  'license', 'keywords', 'metadata', 'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl',
  'defaultEnabled', 'dependencies', 'userConfig', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers',
  'outputStyles', 'workflows', 'experimental', '$schema', 'types', 'channels'])
for (const key of Object.keys(manifest)) {
  ok(`manifest field "${key}" is recognized`, KNOWN_FIELDS.has(key))
}

// Component paths must start with ./ and stay inside the plugin root.
for (const key of ['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows']) {
  const value = manifest[key]
  if (value === undefined || typeof value === 'object') continue
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== 'string') continue
    ok(`${key} path starts with ./`, entry.startsWith('./') || (key === 'skills' && entry === '.'), entry)
    ok(`${key} path has no ".."`, !entry.includes('..'), entry)
    const target = resolve(root, entry)
    ok(`${key} path stays inside the plugin`, !relative(root, target).startsWith('..'), entry)
    ok(`${key} path exists`, statSafe(target).ok, entry)
  }
}

function statSafe(path) {
  try {
    return { ok: true, stat: statSync(path) }
  } catch {
    return { ok: false }
  }
}

ok('no CLAUDE.md at the plugin root', !statSafe(join(root, 'CLAUDE.md')).ok)

/* ------------------------------------------------------------------ agents */

const agentDir = join(root, 'agents')
const agentFiles = statSafe(agentDir).ok ? readdirSync(agentDir).filter(file => file.endsWith('.md')) : []
ok('at least three agents ship', agentFiles.length >= 3, `${agentFiles.length} found`)

const agentNames = new Set()
for (const file of agentFiles) {
  const label = `agents/${file}`
  const fields = frontmatter(read(join('agents', file)), label)
  if (fields === undefined) continue
  const expected = basename(file, '.md')
  ok(`${label} name matches its file`, fields.name === expected, `${fields.name} vs ${expected}`)
  ok(`${label} has a description`, typeof fields.description === 'string' && fields.description.length > 30)
  ok(`${label} declares tools`, fields.tools === undefined || /^[A-Za-z]+(?:,\s*[A-Za-z]+)*$/.test(fields.tools))
  ok(`${label} model is inherit or a known alias`,
    fields.model === undefined || ['inherit', 'sonnet', 'opus', 'haiku'].includes(fields.model), fields.model)
  if (fields.name !== undefined) agentNames.add(fields.name)
}

/* -------------------------------------------------------------------- skills */

const skillDir = join(root, 'skills')
const skillDirs = statSafe(skillDir).ok
  ? readdirSync(skillDir).filter(entry => statSafe(join(skillDir, entry)).ok && statSafe(join(skillDir, entry)).stat.isDirectory())
  : []
ok('at least one skill ships', skillDirs.length > 0)

let skillBody = ''
for (const dir of skillDirs) {
  const label = `skills/${dir}/SKILL.md`
  const file = join(skillDir, dir, 'SKILL.md')
  if (!statSafe(file).ok) {
    fail(`${label} exists`)
    continue
  }
  const text = readFileSync(file, 'utf8')
  skillBody += text
  const fields = frontmatter(text, label)
  if (fields === undefined) continue
  ok(`${label} name matches its directory`, fields.name === dir, `${fields.name} vs ${dir}`)
  ok(`${label} has a description`, typeof fields.description === 'string' && fields.description.length > 40)
  ok(`${label} description says when to use it`, /use when|use it|use this/i.test(fields.description ?? ''))
}

/* ------------------------------------------------------------------ commands */

const commandDir = join(root, 'commands')
const commandFiles = statSafe(commandDir).ok ? readdirSync(commandDir).filter(file => file.endsWith('.md')) : []
for (const file of commandFiles) {
  const label = `commands/${file}`
  const text = readFileSync(join(commandDir, file), 'utf8')
  const fields = frontmatter(text, label)
  if (fields === undefined) continue
  ok(`${label} has a description`, typeof fields.description === 'string' && fields.description.length > 10)
  ok(`${label} takes arguments or explains itself`,
    text.includes('$ARGUMENTS') || fields['argument-hint'] !== undefined)
}

/* ------------------------------------------------------- cross-references */

for (const skill of ['voice-analyst', 'rewriter', 'editor']) {
  ok(`skill references agent ${skill} that exists`, agentNames.has(skill))
  ok(`skill names the namespaced agent ${name}:${skill}`, skillBody.includes(`${name}:${skill}`))
}

for (const script of [...skillBody.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([\w.-]+)/g)]) {
  ok(`skill-referenced script scripts/${script[1]} exists`, statSafe(join(root, 'scripts', script[1])).ok)
}

// Catch a promise-shaped claim, not a prohibition: "any instruction to beat a
// detector only invites fabrication" is the opposite of a promise. Whitespace is
// collapsed because the caveat wraps across lines.
const skillText = skillBody.replace(/\s+/g, ' ')
const DETECTOR_PROMISE = /undetectable|guaranteed? to (?:pass|evade|be detected)|will not be (?:detected|flagged)|cannot be detected|fools? the detector|bypass(?:es)? (?:the |an? |ai )?detectors?/i
ok('skill makes no detector promise', !DETECTOR_PROMISE.test(skillText))
ok('skill states the detector caveat', /cannot guarantee/i.test(skillText) && /detector/i.test(skillText))

/* ---------------------------------------------------------------- marketplace */

const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
let marketplace
try {
  marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'))
  ok('marketplace parses', true)
} catch (error) {
  fail('marketplace parses', error.message)
  marketplace = undefined
}

if (marketplace !== undefined) {
  const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  ok('marketplace has a name', typeof marketplace.name === 'string' && marketplace.name.length > 0)
  ok('marketplace name is a valid id', ID.test(marketplace.name ?? ''), marketplace.name)
  ok('marketplace name has no ".."', !(marketplace.name ?? '').includes('..'))
  ok('marketplace name is not reserved',
    !['claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official', 'anthropic-marketplace',
      'anthropic-plugins', 'agent-skills', 'anthropic-agent-skills', 'inline', 'builtin', 'skills-dir', 'synced',
      'claude-plugin-test', 'claude-community', 'claude-plugins-community', 'healthcare'].includes(marketplace.name ?? ''))
  ok('marketplace does not impersonate a first-party one', !/(official|anthropic|claude)/i.test(marketplace.name ?? ''))
  ok('marketplace has an owner name', typeof marketplace.owner?.name === 'string' && marketplace.owner.name.length > 0)
  ok('marketplace has a description', typeof marketplace.description === 'string' && marketplace.description.length > 20)
  ok('marketplace lists at least one plugin', Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0)

  const seen = new Set()
  for (const [index, entry] of (marketplace.plugins ?? []).entries()) {
    const label = `plugins[${index}]`
    ok(`${label} has a valid name`, ID.test(entry.name ?? ''), entry.name)
    ok(`${label} name is unique`, !seen.has(entry.name), entry.name)
    seen.add(entry.name)
    ok(`${label} name avoids reserved prefixes`, !/^(claude|anthropic|anthropics|cc-plugin)-/.test(entry.name ?? ''))
    ok(`${label} description fits 350 characters`, entry.description === undefined || entry.description.length <= 350,
      `${(entry.description ?? '').length} chars`)
    ok(`${label} source is a relative path`, typeof entry.source === 'string' && (entry.source.startsWith('./') || entry.source === '.'), String(entry.source))
    ok(`${label} source has no ".."`, !String(entry.source).includes('..'))
    const target = resolve(root, entry.source ?? '.')
    ok(`${label} source exists`, statSafe(target).ok, String(entry.source))
    ok(`${label} source stays inside the marketplace`, !relative(root, target).startsWith('..'), String(entry.source))
    // A relative-path entry must point at a real plugin manifest.
    ok(`${label} source holds a plugin.json`, statSafe(join(target, '.claude-plugin', 'plugin.json')).ok)
    ok(`${label} version is omitted so plugin.json wins without a warning`, entry.version === undefined)
  }

  const entry = (marketplace.plugins ?? []).find(item => item.name === name)
  ok('marketplace entry name matches the manifest name', entry !== undefined, name)
  if (entry !== undefined && statSafe(join(root, entry.source, '.claude-plugin', 'plugin.json')).ok) {
    const target = JSON.parse(readFileSync(join(root, entry.source, '.claude-plugin', 'plugin.json'), 'utf8'))
    ok('marketplace entry resolves to this plugin', target.name === name, target.name)
  }
}

/* -------------------------------------------------------------------- files */

for (const required of ['README.md', 'LICENSE']) {
  ok(`${required} ships`, statSafe(join(root, required)).ok)
}
ok('LICENSE is MIT', read('LICENSE').startsWith('MIT License'))

console.log(`\n${checks} checks, ${failures} failure(s)`)
if (failures > 0) process.exitCode = 1

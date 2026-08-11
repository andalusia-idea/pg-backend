/**
 * Regenerates apps/dashboard/prisma/schema.prisma by concatenating the auth,
 * config and transaction schemas.
 *
 * The dashboard owns none of these tables - it reads across all three and writes
 * only to the config tables it exclusively administers. Keeping the merged file
 * generated rather than hand-maintained means it cannot silently drift when one
 * of the source schemas changes.
 *
 *   npm run prisma:merge:dashboard
 *
 * Re-run `npm run prisma:generate:dashboard` afterwards.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUTPUT = path.join(ROOT, 'apps/dashboard/prisma/schema.prisma');

const SOURCES = [
  { app: 'auth', label: 'AUTH' },
  { app: 'config', label: 'CONFIG' },
  { app: 'transaction', label: 'TRANSACTION' },
];

/**
 * Enum names declared by more than one source schema.
 *
 * Prisma requires globally unique identifiers within a single schema file, even
 * across @@schema namespaces, so every copy after the first is renamed. The
 * @@map added alongside points the renamed identifier back at the real Postgres
 * type, which the owning app's own migrations created - so this rename is local
 * to the dashboard client and changes nothing in the database.
 */
const RENAME = {
  config: { TransactionTypeEnum: 'TransactionTypeEnumConfig' },
};

const BANNER = [
  '/// !!! GENERATED FILE - DO NOT EDIT DIRECTLY !!!',
  '///',
  '/// Produced by apps/dashboard/prisma/merge-schema.js from the auth, config',
  '/// and transaction schemas. Edit those, then run:',
  '///   npm run prisma:merge:dashboard && npm run prisma:generate:dashboard',
].join('\n');

const HEADER = [
  'generator client {',
  '  provider            = "prisma-client"',
  '  output              = "../src/generated/prisma"',
  '  moduleFormat        = "esm"',
  '  previewFeatures     = ["typedSql"]',
  '  importFileExtension = "ts"',
  '}',
  '',
  'datasource db {',
  '  provider = "postgresql"',
  '  schemas  = ["auth", "config", "transaction"]',
  '}',
].join('\n');

/** Drops the generator + datasource blocks, keeping only declarations. */
function stripHeader(text, file) {
  const lines = text.split(/\r?\n/);
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 0 && /^(model|enum|type|view)\s+\w+/.test(line)) {
      return lines.slice(i).join('\n').trim();
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  }

  throw new Error(`No model/enum declarations found in ${file}`);
}

function applyRenames(text, renames, app) {
  for (const [from, to] of Object.entries(renames)) {
    const declaration = new RegExp('^enum ' + from + ' \\{$', 'm');
    if (!declaration.test(text)) {
      throw new Error(
        `Expected to rename enum '${from}' in the ${app} schema, but it is no ` +
          `longer declared there. Update RENAME in merge-schema.js.`,
      );
    }
    text = text.replace(declaration, 'enum ' + to + ' {');

    // Insert @@map immediately before the enum's @@schema attribute.
    text = text.replace(
      new RegExp('(enum ' + to + ' \\{[\\s\\S]*?)(\\n\\s*@@schema\\()', 'm'),
      '$1\n  /// Renamed for this merged schema only; the Postgres type is unchanged.\n  @@map("' +
        from +
        '")$2',
    );

    // Reference sites: field types, including the list form `Enum[]`.
    text = text.replace(
      new RegExp('(\\s)' + from + '(\\[\\])?(\\s|$)', 'gm'),
      '$1' + to + '$2$3',
    );
  }
  return text;
}

const parts = [`${BANNER}\n\n${HEADER}`];

for (const { app, label } of SOURCES) {
  const file = path.join(ROOT, 'apps', app, 'prisma', 'schema.prisma');
  let body = stripHeader(fs.readFileSync(file, 'utf8'), file);
  if (RENAME[app]) body = applyRenames(body, RENAME[app], app);

  parts.push(
    `////////////////////\n// ${label}\n////////////////////\n\n${body}`,
  );
}

fs.writeFileSync(OUTPUT, parts.join('\n\n') + '\n', 'utf8');
console.log(
  `Merged ${SOURCES.map((s) => s.app).join(' + ')} -> apps/dashboard/prisma/schema.prisma`,
);

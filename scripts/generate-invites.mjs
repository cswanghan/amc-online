#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function parseArgs(argv) {
  const options = {
    count: 10,
    maxUses: 5,
    expiresInDays: 90,
    creatorId: 1,
    db: 'kangaroo-users',
    remote: false,
    local: false,
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--count' && next) {
      options.count = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg === '--max-uses' && next) {
      options.maxUses = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg === '--expires-in-days' && next) {
      options.expiresInDays = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg === '--creator-id' && next) {
      options.creatorId = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if (arg === '--db' && next) {
      options.db = next;
      i += 1;
      continue;
    }

    if (arg === '--cwd' && next) {
      options.cwd = next;
      i += 1;
      continue;
    }

    if (arg === '--remote') {
      options.remote = true;
      continue;
    }

    if (arg === '--local') {
      options.local = true;
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 200) {
    throw new Error('--count must be an integer between 1 and 200');
  }

  if (!Number.isInteger(options.maxUses) || options.maxUses < 1 || options.maxUses > 50) {
    throw new Error('--max-uses must be an integer between 1 and 50');
  }

  if (!Number.isInteger(options.expiresInDays) || options.expiresInDays < 1 || options.expiresInDays > 365) {
    throw new Error('--expires-in-days must be an integer between 1 and 365');
  }

  if (!Number.isInteger(options.creatorId) || options.creatorId < 1) {
    throw new Error('--creator-id must be a positive integer');
  }

  if (options.remote && options.local) {
    throw new Error('Choose only one of --remote or --local');
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-invites.mjs [options]

Options:
  --count <n>             Number of invite codes to create. Default: 10
  --max-uses <n>          Allowed uses per code. Default: 5
  --expires-in-days <n>   Validity window in days. Default: 90
  --creator-id <id>       Creator user id. Default: 1
  --db <name>             D1 database name or binding. Default: kangaroo-users
  --remote                Execute against remote D1
  --local                 Execute against local D1
  --cwd <path>            Working directory passed to wrangler
  --help                  Show this message

Without --remote or --local, the script only prints SQL and generated codes.`);
}

function formatSqlDate(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    ' ',
    pad(date.getUTCHours()),
    ':',
    pad(date.getUTCMinutes()),
    ':',
    pad(date.getUTCSeconds()),
  ].join('');
}

function generateInviteCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => CHARSET[byte % CHARSET.length]).join('');
}

function buildBatch(count) {
  const codes = new Set();

  while (codes.size < count) {
    codes.add(generateInviteCode());
  }

  return Array.from(codes);
}

function buildSql(codes, options) {
  const expiresAt = new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000);
  const expiresAtSql = formatSqlDate(expiresAt);

  const statements = codes.map((code) => (
    `INSERT INTO invite_codes (code, creator_id, max_uses, expires_at) VALUES ('${code}', ${options.creatorId}, ${options.maxUses}, '${expiresAtSql}')`
  ));

  return {
    expiresAtSql,
    sql: `${statements.join(';\n')};`,
  };
}

function maybeExecute(sql, options) {
  if (!options.remote && !options.local) {
    return null;
  }

  const args = [
    'wrangler',
    'd1',
    'execute',
    options.db,
    '--command',
    sql,
    '--json',
  ];

  if (options.remote) {
    args.push('--remote');
  }

  if (options.local) {
    args.push('--local');
  }

  const output = execFileSync('npx', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(output);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const codes = buildBatch(options.count);
  const { expiresAtSql, sql } = buildSql(codes, options);
  const result = maybeExecute(sql, options);

  const payload = {
    count: options.count,
    maxUses: options.maxUses,
    expiresInDays: options.expiresInDays,
    creatorId: options.creatorId,
    expiresAt: expiresAtSql,
    codes,
    executed: Boolean(result),
    result,
    sql,
  };

  console.log(JSON.stringify(payload, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

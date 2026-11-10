import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolVersions = { bun: '1.4.4', node: '24.16.0', pnpm: '12.4.1' };

/** Fail before building or connecting to any database; never include secret values in errors. */
export const assertNetlifyEnvironment = (env, root = projectRoot) => {
  if (env.NETLIFY !== 'true' || env.CONTEXT !== 'production') {
    throw new Error('This build is restricted to the dedicated Netlify production deployment.');
  }
  if (env.NEXA_LOBE_MIGRATE !== '1') {
    throw new Error('Set NEXA_LOBE_MIGRATE=1 only on the dedicated LobeHub deployment.');
  }
  for (const key of [
    'DATABASE_URL',
    'NEXA_LOBE_DB_HOST',
    'NEXA_LOBE_DB_NAME',
    'APP_URL',
    'AUTH_SECRET',
    'KEY_VAULTS_SECRET',
  ]) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`);
  }

  let database;
  let app;
  try {
    database = new URL(env.DATABASE_URL);
    app = new URL(env.APP_URL);
  } catch {
    throw new Error('DATABASE_URL and APP_URL must be valid URLs.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname.endsWith('.neon.tech') ||
    database.hostname !== env.NEXA_LOBE_DB_HOST ||
    database.pathname !== `/${env.NEXA_LOBE_DB_NAME}` ||
    (database.port && database.port !== '5432') ||
    !database.username ||
    !database.password ||
    [...database.searchParams.keys()].some((key) => !['sslmode', 'channel_binding'].includes(key)) ||
    !['require', 'verify-full'].includes(database.searchParams.get('sslmode'))
  ) {
    throw new Error('DATABASE_URL must match the explicitly approved Neon host/database with TLS.');
  }
  if (app.protocol !== 'https:' || app.username || app.password) {
    throw new Error('APP_URL must be the public HTTPS URL without credentials.');
  }
  if (env.FTS_SEARCH_PROVIDER !== 'pg_like') {
    throw new Error('Set FTS_SEARCH_PROVIDER=pg_like for the dedicated Neon database.');
  }
  if (env.DATABASE_DRIVER && !['neon', 'node'].includes(env.DATABASE_DRIVER)) {
    throw new Error('DATABASE_DRIVER must be neon (the default) or node.');
  }

  // Both Bun and the upstream migrator load dotenv files. Prevent them replacing the
  // guarded database URL with local credentials after the allowlist check.
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(path.join(root, name))) {
      throw new Error(`Remove ${name} from the Netlify build; use scoped platform variables.`);
    }
  }
};

const assertToolVersions = () => {
  if (process.versions.node !== toolVersions.node) {
    throw new Error(`Netlify build requires Node.js ${toolVersions.node}.`);
  }
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (!manifest.packageManager.startsWith(`pnpm@${toolVersions.pnpm}+`)) {
    throw new Error('Review the Netlify pnpm pin after changing packageManager.');
  }
  for (const tool of ['bun', 'pnpm']) {
    const result = spawnSync(tool, ['--version'], { encoding: 'utf8' });
    if (result.status !== 0 || result.stdout?.trim() !== toolVersions[tool]) {
      throw new Error(`Netlify build requires ${tool} ${toolVersions[tool]}.`);
    }
  }
};

export const runNetlifyBuild = () => {
  const env = { ...process.env, NODE_ENV: 'production' };
  assertNetlifyEnvironment(env);
  assertToolVersions();
  rmSync(path.join(projectRoot, '.next'), { force: true, recursive: true });
  rmSync(path.join(projectRoot, 'node_modules/.cache'), { force: true, recursive: true });

  // Reuse upstream scripts. Do not migrate if compilation fails.
  for (const script of ['build', 'db:migrate']) {
    assertNetlifyEnvironment(env);
    const result = spawnSync('bun', ['run', script], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`Netlify ${script} failed; deployment stopped.`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runNetlifyBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

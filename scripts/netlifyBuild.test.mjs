import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { assertNetlifyEnvironment } from './netlifyBuild.mjs';

const validEnv = {
  APP_URL: 'https://nexa-lobe.example.com',
  AUTH_SECRET: 'test-only-not-a-real-secret',
  CONTEXT: 'production',
  DATABASE_DRIVER: 'neon',
  DATABASE_URL: 'postgresql://test:dummy@ep-dedicated.us-east-2.aws.neon.tech/lobehub?sslmode=require',
  FTS_SEARCH_PROVIDER: 'pg_like',
  KEY_VAULTS_SECRET: 'test-only-not-a-real-secret',
  NETLIFY: 'true',
  NEXA_LOBE_DB_HOST: 'ep-dedicated.us-east-2.aws.neon.tech',
  NEXA_LOBE_DB_NAME: 'lobehub',
  NEXA_LOBE_MIGRATE: '1',
};

test('allows the explicitly selected dedicated database without connecting to it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nexa-netlify-guard-'));
  try {
    assert.doesNotThrow(() => assertNetlifyEnvironment(validEnv, root));
    assert.doesNotThrow(() => assertNetlifyEnvironment({ ...validEnv, DATABASE_DRIVER: undefined }, root));
    assert.doesNotThrow(() => assertNetlifyEnvironment({ ...validEnv, DATABASE_DRIVER: 'node' }, root));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('refuses preview builds, missing opt-in, wrong database, non-TLS, and unsafe overrides', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nexa-netlify-guard-'));
  try {
    for (const patch of [
      { NETLIFY: undefined },
      { CONTEXT: 'deploy-preview' },
      { NEXA_LOBE_MIGRATE: undefined },
      { NEXA_LOBE_DB_HOST: 'ep-other.us-east-2.aws.neon.tech' },
      { NEXA_LOBE_DB_NAME: 'dispatch' },
      { DATABASE_URL: validEnv.DATABASE_URL.replace('?sslmode=require', '') },
      { DATABASE_URL: validEnv.DATABASE_URL.replace('.neon.tech', '.supabase.co') },
      { DATABASE_URL: `${validEnv.DATABASE_URL}&host=other.example.com` },
      { DATABASE_URL: `${validEnv.DATABASE_URL}&dbname=dispatch` },
      { DATABASE_URL: 'not-a-url' },
      { AUTH_SECRET: '' },
      { KEY_VAULTS_SECRET: '' },
      { APP_URL: 'http://nexa-lobe.example.com' },
      { FTS_SEARCH_PROVIDER: 'pg_search' },
      { DATABASE_DRIVER: 'unknown' },
    ]) {
      assert.throws(() => assertNetlifyEnvironment({ ...validEnv, ...patch }, root));
    }
    for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      writeFileSync(path.join(root, file), 'DATABASE_URL=do-not-load');
      assert.throws(() => assertNetlifyEnvironment(validEnv, root), /scoped platform variables/);
      rmSync(path.join(root, file));
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('invalid credentials are never included in guard errors', () => {
  const secret = 'secret-that-must-not-be-logged';
  assert.throws(
    () => assertNetlifyEnvironment({ ...validEnv, DATABASE_URL: secret }),
    (error) => !error.message.includes(secret),
  );
});

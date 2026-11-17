// The API refuses to start in production with laptop settings left on.
//
//   npx tsx --test test/production-guard.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unsafeProductionSettings } = require('../src/production-guard');

const env = (values) => (key) => values[key];
const SAFE = {
  NODE_ENV: 'production',
  AUTH_DEV_USER: 'false',
  DEV_ENDPOINTS: 'false',
  JWT_ACCESS_SECRET: 'k3-real-secret-one',
  JWT_REFRESH_SECRET: 'k3-real-secret-two',
  BYOK_ENCRYPTION_KEY: 'k3-real-32-byte-key',
};

test('a properly filled production .env starts', () => {
  assert.deepEqual(unsafeProductionSettings(env(SAFE)), []);
});

test('.env.example copied to a server unchanged is refused, naming every problem', () => {
  const copied = {
    NODE_ENV: 'production',
    AUTH_DEV_USER: 'true',
    DEV_ENDPOINTS: 'true',
    JWT_ACCESS_SECRET: 'change-me',
    JWT_REFRESH_SECRET: 'change-me-differently',
    BYOK_ENCRYPTION_KEY: 'change-me-32-bytes',
  };
  const problems = unsafeProductionSettings(env(copied));
  assert.equal(problems.length, 5);
  for (const key of Object.keys(copied).filter((k) => k !== 'NODE_ENV')) {
    assert.ok(problems.some((p) => p.includes(key)), `mentions ${key}`);
  }
});

test('each dangerous flag is caught on its own, whatever its capitalisation', () => {
  assert.equal(unsafeProductionSettings(env({ ...SAFE, AUTH_DEV_USER: 'True' })).length, 1);
  assert.equal(unsafeProductionSettings(env({ ...SAFE, DEV_ENDPOINTS: ' TRUE ' })).length, 1);
  assert.equal(unsafeProductionSettings(env({ ...SAFE, JWT_ACCESS_SECRET: undefined })).length, 1);
});

test('development is left alone: the same settings are how a laptop runs', () => {
  assert.deepEqual(unsafeProductionSettings(env({ NODE_ENV: 'development', AUTH_DEV_USER: 'true', DEV_ENDPOINTS: 'true' })), []);
  assert.deepEqual(unsafeProductionSettings(env({ AUTH_DEV_USER: 'true' })), []);
});

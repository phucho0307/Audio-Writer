// Rankings arithmetic: the Bayesian "Hay nhất" score and the "Đang hot" decay.
//
//   npx tsx --test test/rankings.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bayesian, hotWeights, PRIOR_WEIGHT, HOT_DAYS } = require('../src/rankings/rankings.service');

test('a single 5-star rating does not outrank forty ratings averaging 4.7', () => {
  const lucky = bayesian(5, 1, 3.8);
  const proven = bayesian(4.7 * 40, 40, 3.8);
  assert.ok(proven > lucky);
});

test('no ratings sits exactly at the site mean; many ratings approach their own mean', () => {
  assert.equal(bayesian(0, 0, 3.8), 3.8);
  assert.ok(Math.abs(bayesian(4.5 * 10_000, 10_000, 3.8) - 4.5) < 0.001);
  assert.equal(bayesian(5 * PRIOR_WEIGHT, PRIOR_WEIGHT, 3), 4, 'equal weight: halfway');
});

test('hot weights: today counts fully, then each day a little less, for a week', () => {
  const w = hotWeights();
  assert.equal(w.length, HOT_DAYS);
  assert.equal(w[0], 1);
  for (let i = 1; i < w.length; i++) assert.ok(w[i] < w[i - 1]);
  assert.ok(w[w.length - 1] > 0.3, 'last week still counts for something');
});

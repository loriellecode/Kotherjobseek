'use strict';
const t = require('node:test');
const assert = require('node:assert/strict');
const KJ = require('../shared/match');

t.describe('pay shown as hourly and annual', () => {
  t.it('annual → hourly equivalent, hourly → annual equivalent, estimates labelled, unknown stays unknown', () => {
    assert.deepEqual([KJ.salaryParts({ salaryMin: 78000, salaryMax: 92000, salaryPeriod: 'year' }).main, KJ.salaryParts({ salaryMin: 78000, salaryMax: 92000, salaryPeriod: 'year' }).alt], ['$78,000–$92,000/yr', '≈ $37.50–$44.23/hr']);
    const h = KJ.salaryParts({ salaryMin: 28, salaryMax: 34.5, salaryPeriod: 'hour' }); assert.equal(h.main, '$28.00–$34.50/hr'); assert.equal(h.alt, '≈ $58,240–$71,760/yr full-time');
    assert.equal(KJ.salaryParts({ salaryMin: 62400, salaryMax: 62400, salaryPeriod: 'year' }).alt, '≈ $30.00/hr');
    assert.match(KJ.salaryParts({ salaryMin: 70000, salaryMax: 80000, salaryEstimated: true }).alt, /estimated/); assert.equal(KJ.salaryParts({}), null);
  });
  t.it('her thresholds read correctly in both forms ($28/hr = $58,240/yr; $30/hr = $62,400/yr)', () => {
    assert.equal(KJ.salaryParts({ salaryMin: 58240, salaryMax: 58240, salaryPeriod: 'year' }).alt, '≈ $28.00/hr'); assert.equal(KJ.salaryParts({ salaryMin: 30, salaryMax: 30, salaryPeriod: 'hour' }).alt, '≈ $62,400/yr full-time');
  });
});

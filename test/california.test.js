const test = require('node:test'), assert = require('node:assert');
const KJ = require('../shared/match');
test('only California listings are kept', () => {
  assert(KJ.inSearchStates({ state: 'California', locationText: 'Stockton, California' }));
  assert(KJ.inSearchStates({ state: 'CA' }));
  assert(!KJ.inSearchStates({ state: 'Louisiana', locationText: 'Hammond, Louisiana' }));
  assert(!KJ.inSearchStates({ state: null, locationText: 'Hammond, LA 70401' }));
  assert(!KJ.inSearchStates({ state: null, locationText: 'Baton Rouge, Louisiana', remote: true }));
  assert(!KJ.inSearchStates({ state: 'TX', locationText: 'Austin, TX', remote: true }));
  assert(KJ.inSearchStates({ state: null, locationText: '', remote: true }), 'remote with no state is kept');
  assert(!KJ.inSearchStates({ state: null, locationText: 'Somewhere', remote: false }), 'unknown-state on-site hidden');
});
test('a listing with no state but a known California city is kept', () => {
  assert(KJ.inSearchStates({ state: null, locationText: 'Stockton', city: 'Stockton' }));
  assert(!KJ.inSearchStates({ state: null, locationText: 'Hammond', city: 'Hammond' }));
});
test('Los Angeles-area suburbs: shown only when pay is known and meets the minimum and nothing required is missing', () => {
  const profile = { titles: [], categories: ['Finance'], types: ['Full-time'], workModes: ['onsite'], cities: ['Stockton, CA'], commuteMiles: 30, statewide: true, farAreas: ['Pasadena, CA', 'Glendale, CA'], salary: { min: 28, desired: 30, period: 'hour', showBelow: false }, education: [{ level: 'bachelor', field: 'Finance', verified: true }], experience: [], certs: [], skills: [] };
  const mk = (o) => Object.assign({ id: 1, title: 'Budget Analyst', employer: 'X', city: 'Pasadena', state: 'California', locationText: 'Pasadena, California', description: 'Prepare budgets.', required: [], preferred: [], categories: ['Finance'], education: null, experience: null, certifications: [], salaryPeriod: 'year', status: 'active', userState: {} }, o);
  const vis = (j) => { j.match = KJ.evaluate(j, profile, {}); return !j.match.excluded.farArea && !j.match.excluded.belowFloor; };
  assert.equal(vis(mk({ salaryMin: 90000, salaryMax: 100000 })), true, 'pay above her minimum');
  assert.equal(vis(mk({ salaryMin: 50000, salaryMax: 52000 })), false, 'pay below her minimum');
  assert.equal(vis(mk({ salaryMin: null, salaryMax: null })), false, 'pay not listed');
  assert.equal(vis(mk({ salaryMin: 90000, salaryMax: 100000, education: { level: 'doctorate', preferred: false } })), false, 'a required qualification she lacks');
  assert.equal(vis(mk({ city: 'Fresno', locationText: 'Fresno, California', salaryMin: null, salaryMax: null })), true, 'other California places keep the normal rules');
});

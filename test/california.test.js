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

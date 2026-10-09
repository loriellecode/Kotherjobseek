'use strict';
/* Provider registry. To add a source: create a module exporting
 *   { id, name, kind, docs, setup[], configured() -> {ok, missing[]}, budget() -> calls/day, search(query) -> {listings[], total} }
 * (optionally queriesFor() for fixed-feed providers) and add it to the list below. Nothing else needs to change. */
module.exports = [require('./adzuna'), require('./usajobs'), require('./feeds')];

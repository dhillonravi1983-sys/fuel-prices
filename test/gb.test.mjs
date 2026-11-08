import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, parseCsv } from '../collectors/gb.mjs';

const S = (id, o = {}) => ({ node_id: id, name: 'N' + id, brand: 'BP', latitude: '51.5', longitude: '-0.1', temporarily_closed: '0', members_only: '0', coordinates_fix: '', ...o });
const H = (id, fuel, date, p) => ({ node_id: id, fuel, date, price_ppl: p, price_last_updated: '2026-11-05T12:00:00.000Z' });
const NOW = new Date('2026-11-08T12:00:00Z');

test('CSV parser handles quotes, commas and doubled quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [{ a: 'x, y', b: 'say "hi"' }]);
});

test('latest day wins, pence become pounds x1000, closed/members/outside-UK stations are dropped', () => {
  const out = build(
    [S('aaaaaaaaaaaaaaaa'), S('bbbbbbbbbbbbbbbb', { temporarily_closed: '1' }), S('cccccccccccccccc', { members_only: '1' }),
     S('dddddddddddddddd', { coordinates_fix: 'outside_uk' }), S('eeeeeeeeeeeeeeee', { latitude: '0', longitude: '0' })],
    [H('aaaaaaaaaaaaaaaa', 'E10', '2026-11-07', '140.9'), H('aaaaaaaaaaaaaaaa', 'E10', '2026-11-08', '141.9'),
     H('aaaaaaaaaaaaaaaa', 'B7_STANDARD', '2026-11-08', '150.5'), H('aaaaaaaaaaaaaaaa', 'HVO', '2026-11-08', '190'),
     H('bbbbbbbbbbbbbbbb', 'E10', '2026-11-08', '1'), H('cccccccccccccccc', 'E10', '2026-11-08', '1'),
     H('dddddddddddddddd', 'E10', '2026-11-08', '1'), H('eeeeeeeeeeeeeeee', 'E10', '2026-11-08', '1')],
    NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'gb:aaaaaaaaaaaa');
  assert.deepEqual(Object.keys(out[0].p).sort(), ['b7', 'e10']);
  assert.equal(out[0].p.e10[0], 1419);
  assert.equal(out[0].p.b7[0], 1505);
});

test('prices older than 2 days throw instead of publishing stale data', () => {
  assert.throws(() => build([], [H('a', 'E10', '2026-11-01', '140')], NOW), /no prices newer/);
});

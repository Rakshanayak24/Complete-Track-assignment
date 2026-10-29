import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTransaction } from '../src/normalize';
import { monthKey, totals } from '../src/money';
import { Transaction } from '../src/types';

const fixtureDir = join(__dirname, '..', 'track-api-mock', 'fixtures');
const hasFixtures = existsSync(join(fixtureDir, 'transactions.json'));
const suite = hasFixtures ? describe : describe.skip;

suite('mock API final state matches its checkpoint', () => {
  const transactions = JSON.parse(readFileSync(join(fixtureDir, 'transactions.json'), 'utf8')) as unknown[];
  const changes = JSON.parse(readFileSync(join(fixtureDir, 'changes.json'), 'utf8')) as unknown[];
  const checkpoint = JSON.parse(readFileSync(join(fixtureDir, 'checkpoint.json'), 'utf8')) as {
    transaction_count: number; months: Record<string, { spend: string; income: string }>;
  };
  const finalRows = new Map<string, Transaction>();
  for (const raw of transactions) { const tx = normalizeTransaction(raw); finalRows.set(tx.id, tx); }
  for (const raw of changes) {
    const change = raw as Record<string, unknown>;
    if (change.deleted === true) finalRows.delete(String(change.id));
    else {
      const tx = normalizeTransaction(raw); const old = finalRows.get(tx.id);
      if (!old || Date.parse(tx.updated_at ?? tx.occurred_at) >= Date.parse(old.updated_at ?? old.occurred_at)) finalRows.set(tx.id, tx);
    }
  }

  it('keeps every transaction ID exactly once after duplicate boundary pages and changes', () => {
    expect(finalRows.size).toBe(checkpoint.transaction_count);
  });
  it('reconciles all checkpoint months using India dates, own-transfer filtering, and INR FX values', () => {
    const all = [...finalRows.values()];
    const grouped = new Map<string, Transaction[]>();
    for (const tx of all) { const key = monthKey(tx.occurred_at); const rows = grouped.get(key) ?? []; rows.push(tx); grouped.set(key, rows); }
    for (const [key, expected] of Object.entries(checkpoint.months)) {
      const actual = totals(grouped.get(key) ?? [], all);
      expect(actual.unconverted).toBe(0);
      expect((actual.spent / 100).toFixed(2)).toBe(expected.spend);
      expect((actual.income / 100).toFixed(2)).toBe(expected.income);
    }
  });
});

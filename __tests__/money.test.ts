import { formatMoney, isInternalTransfer, monthKey, totals } from '../src/money';
import { applyChanges, emptyState, mergeRows } from '../src/sync';
import { normalizeTransaction } from '../src/normalize';
import { Transaction } from '../src/types';
const tx = (overrides: Partial<Transaction> = {}): Transaction => ({ id: '1', occurred_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', direction: 'debit', amount_minor: 1050, currency: 'INR', category: 'FOOD', ...overrides });

describe('money and transaction rules', () => {
  it('formats paise without floating point loss and uses Indian grouping', () => expect(formatMoney(123456789)).toBe('₹12,34,567.89'));
  it('groups timestamps into India calendar month', () => expect(monthKey('2025-12-31T20:00:00Z')).toBe('2026-01'));
  it('excludes paired own-account transfers from spend and income', () => {
    const a = tx({ id: 'a', account_id: 'one', category: 'TRANSFER' });
    const b = tx({ id: 'b', account_id: 'two', category: 'TRANSFER', direction: 'credit', occurred_at: '2026-01-01T01:00:00Z' });
    expect(isInternalTransfer(a, [a,b])).toBe(true);
    expect(totals([a,b], [a,b])).toEqual({ spent: 0, income: 0, unconverted: 0 });
  });
  it('does not classify unrelated debit transactions as transfers', () => expect(isInternalTransfer(tx(), [tx()])).toBe(false));
  it('normalizes legacy decimal rupees exactly', () => {
    const legacy = normalizeTransaction({ id: '123', account: '4821', txn_time: 1774981380, type: 'DR', amount: '516.49', merchant_name: 'BLINKIT', status: 'POSTED' });
    expect(legacy).toMatchObject({ id: '123', account_id: 'acc_4821', direction: 'debit', amount_minor: 51649, currency: 'INR', merchant: 'BLINKIT', occurred_at: '2026-03-31T18:23:00.000Z' });
  });
  it('uses a supplied INR equivalent for foreign-currency totals', () => {
    const usd = tx({ currency: 'USD', amount_minor: 1000, fx: { inr_minor: 86661 } });
    expect(totals([usd])).toEqual({ spent: 86661, income: 0, unconverted: 0 });
  });
  it('does not silently add unconvertible foreign amounts to rupee totals', () => {
    const usd = tx({ currency: 'USD', amount_minor: 1000 });
    expect(totals([usd])).toEqual({ spent: 0, income: 0, unconverted: 1 });
  });
  it('excludes transfers marked as another owned account', () => {
    const own = tx({ account_id: 'acc_1', category: 'TRANSFER', counterparty: { type: 'OWN_ACCOUNT', account_id: 'acc_2' } });
    expect(totals([own])).toEqual({ spent: 0, income: 0, unconverted: 0 });
  });
  it('keeps the row with the latest server update timestamp', () => {
    const old = tx({ merchant: 'old' }); const latest = tx({ merchant: 'new', updated_at: '2026-01-02T00:00:00Z' });
    expect(mergeRows([old], [latest])[0].merchant).toBe('new');
  });
  it('applies only newer deletion tombstones and update events', () => {
    const old = tx({ id: 'keep', updated_at: '2026-01-02T00:00:00Z' });
    const state = { ...emptyState, hasSynced: true, transactions: [old] };
    const olderDelete = applyChanges(state, [{ id: 'keep', deleted: true, updated_at: '2026-01-01T00:00:00Z' }], 'token-1', []);
    expect(olderDelete.transactions).toHaveLength(1);
    const newerDelete = applyChanges(state, [{ id: 'keep', deleted: true, updated_at: '2026-01-03T00:00:00Z' }], 'token-2', []);
    expect(newerDelete.transactions).toHaveLength(0);
    const newerUpdate = applyChanges(state, [tx({ id: 'keep', merchant: 'corrected', updated_at: '2026-01-03T00:00:00Z' })], 'token-3', []);
    expect(newerUpdate.transactions[0].merchant).toBe('corrected');
  });
});

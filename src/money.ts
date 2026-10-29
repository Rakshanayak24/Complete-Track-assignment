import { Transaction } from './types';

export function formatMoney(minor: number, currency = 'INR', signed = false): string {
  const amount = Math.abs(minor) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
  return signed && minor !== 0 ? `${minor < 0 ? '−' : '+'}${formatted}` : formatted;
}

const transferWord = /\b(own account|self transfer|between accounts|internal transfer)\b/i;
export function isInternalTransfer(tx: Transaction, all: Transaction[]): boolean {
  const row = tx as Record<string, unknown>;
  if (row.is_internal_transfer === true || row.internal_transfer === true || row.transfer_type === 'INTERNAL') return true;
  const text = `${tx.merchant ?? ''} ${String(row.description ?? '')} ${String(row.counterparty_name ?? '')}`;
  if (transferWord.test(text)) return true;
  const counterparty = row.counterparty && typeof row.counterparty === 'object' ? row.counterparty as Record<string, unknown> : undefined;
  if (counterparty?.type === 'OWN_ACCOUNT') return true;
  if (typeof counterparty?.account_id === 'string' && counterparty.account_id.startsWith('acc_') && counterparty.account_id !== tx.account_id) return true;
  if ((tx.category ?? '').toUpperCase() !== 'TRANSFER') return false;
  const explicitAccount = row.counterparty_account_id ?? row.destination_account_id ?? row.source_account_id ?? row.linked_account;
  if (typeof explicitAccount === 'string' && explicitAccount !== tx.account_id) return true;
  const time = Date.parse(tx.occurred_at);
  return all.some(other => {
    if (other.id === tx.id || other.account_id === tx.account_id || other.currency !== tx.currency) return false;
    if (other.category?.toUpperCase() !== 'TRANSFER' || Math.abs(other.amount_minor) !== Math.abs(tx.amount_minor)) return false;
    if (other.direction.toLowerCase() === tx.direction.toLowerCase()) return false;
    const delta = Math.abs(Date.parse(other.occurred_at) - time);
    return Number.isFinite(delta) && delta <= 36 * 60 * 60 * 1000;
  });
}

export function monthKey(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value ?? '0000';
  const month = parts.find(p => p.type === 'month')?.value ?? '00';
  return `${year}-${month}`;
}
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(Date.UTC(year, month - 1, 1)));
}
export function totals(rows: Transaction[], all = rows) {
  return rows.reduce((sum, tx) => {
    if (isInternalTransfer(tx, all) || tx.status?.toUpperCase() === 'DECLINED') return sum;
    const fx = tx.fx?.inr_minor;
    const value = tx.currency === 'INR' ? tx.amount_minor : fx;
    if (!Number.isSafeInteger(value)) { sum.unconverted += 1; return sum; }
    if (tx.direction.toLowerCase() === 'credit') sum.income += Math.abs(value as number);
    else if (tx.direction.toLowerCase() === 'debit') sum.spent += Math.abs(value as number);
    return sum;
  }, { spent: 0, income: 0, unconverted: 0 });
}

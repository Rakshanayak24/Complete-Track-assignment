import { Transaction } from './types';

function decimalToMinor(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Transaction amount is missing');
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal amount: ${text}`);
  const fraction = match[3] ?? '';
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) throw new Error(`Amount has fractions smaller than one paisa: ${text}`);
  const paise = BigInt(match[2]) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  const result = Number(match[1] ? -paise : paise);
  if (!Number.isSafeInteger(result)) throw new Error(`Transaction amount is outside the supported range: ${text}`);
  return result;
}

function normalizeDate(value: unknown): string {
  let date: Date;
  if (typeof value === 'number') date = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string') date = new Date(value);
  else throw new Error('Transaction date is missing');
  if (!Number.isFinite(date.getTime())) throw new Error('Transaction date is invalid');
  return date.toISOString();
}

/** Converts both documented and legacy fixture records into one typed shape. */
export function normalizeTransaction(value: unknown): Transaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Transaction is not an object');
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').trim();
  if (!id) throw new Error('Transaction ID is missing');
  const occurredAt = normalizeDate(raw.occurred_at ?? raw.txn_time);
  const rawDirection = String(raw.direction ?? raw.type ?? '').toLowerCase();
  const direction = rawDirection === 'dr' ? 'debit' : rawDirection === 'cr' ? 'credit' : rawDirection;
  const account = raw.account_id ?? raw.account;
  const accountId = account == null ? undefined : String(account).startsWith('acc_') ? String(account) : `acc_${account}`;
  const counterparty: Record<string, unknown> | undefined = raw.counterparty && typeof raw.counterparty === 'object' && !Array.isArray(raw.counterparty)
    ? raw.counterparty as Record<string, unknown>
    : raw.linked_account != null
      ? { type: 'OWN_ACCOUNT', account_id: String(raw.linked_account).startsWith('acc_') ? String(raw.linked_account) : `acc_${raw.linked_account}` }
      : undefined;
  const amountMinor = raw.amount_minor == null ? decimalToMinor(raw.amount) : Number(raw.amount_minor);
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Transaction minor-unit amount is invalid');
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => ![
    'id', 'account', 'account_id', 'txn_time', 'occurred_at', 'direction', 'type', 'amount', 'amount_minor',
    'currency', 'merchant_name', 'merchant', 'category', 'status', 'updated_at', 'counterparty', 'linked_account',
  ].includes(key)));
  return {
    ...extras,
    id,
    account_id: accountId,
    occurred_at: occurredAt,
    direction,
    amount_minor: amountMinor,
    currency: typeof raw.currency === 'string' && raw.currency ? raw.currency : 'INR',
    merchant: typeof (raw.merchant ?? raw.merchant_name) === 'string' ? String(raw.merchant ?? raw.merchant_name) : undefined,
    category: typeof raw.category === 'string' && raw.category ? raw.category : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    updated_at: typeof raw.updated_at === 'string' ? normalizeDate(raw.updated_at) : occurredAt,
    ...(counterparty ? { counterparty } : {}),
  };
}

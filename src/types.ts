export type Account = { id: string; bank?: string; type?: string; last4?: string; nickname?: string };
export type Transaction = {
  id: string; account_id?: string; occurred_at: string; direction: string;
  amount_minor: number; currency: string; merchant?: string; category?: string;
  fx?: { inr_minor?: number; [key: string]: unknown };
  counterparty?: { type?: string; account_id?: string; [key: string]: unknown };
  status?: string; updated_at?: string; [key: string]: unknown;
};
export type StoredState = {
  transactions: Transaction[]; accounts: Account[]; syncToken: string | null;
  lastSyncedAt: string | null; hasSynced: boolean;
};
export type Page<T> = { items: T[]; next_cursor: string | null; sync_token?: string };

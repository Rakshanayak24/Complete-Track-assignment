import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Account, StoredState, Transaction } from './src/types';
import { emptyState, syncState } from './src/sync';
import { formatMoney, monthKey, monthLabel, totals } from './src/money';

const STORAGE_KEY = 'track.state.v1';
type Row = { kind: 'month'; key: string; count: number; spent: number; income: number; unconverted: number } | { kind: 'transaction'; tx: Transaction };
const palette = { ink: '#17231e', muted: '#78847c', green: '#146b4d', mint: '#e9f4ee', bg: '#f7f8f6', line: '#e8ece8', white: '#fff', orange: '#bd6437' };

function accountName(tx: Transaction, accounts: Account[]) {
  const account = accounts.find(a => a.id === tx.account_id);
  return account?.nickname || account?.bank || (account?.last4 ? `Account · ${account.last4}` : 'Account');
}
function dayLabel(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
function titleFor(tx: Transaction) { return tx.merchant?.trim() || 'Unknown merchant'; }
function rupeeEquivalent(tx: Transaction) { return Number.isSafeInteger(tx.fx?.inr_minor) ? formatMoney(tx.fx!.inr_minor!, 'INR') : null; }

export default function App() {
  const [data, setData] = useState<StoredState>(emptyState);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncLock = useRef<Promise<void> | null>(null);
  const started = useRef(false);

  const save = useCallback(async (next: StoredState) => {
    setData(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);
  const refresh = useCallback(async () => {
    if (syncLock.current) return syncLock.current;
    const job = (async () => {
      setRefreshing(true); setSyncError(null);
      try { await save(await syncState(data)); }
      catch (error) { setSyncError(error instanceof Error ? error.message : 'Could not sync. Try again.'); }
      finally { setRefreshing(false); syncLock.current = null; }
    })();
    syncLock.current = job; return job;
  }, [data, save]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as StoredState;
          setData({ ...emptyState, ...cached, transactions: Array.isArray(cached.transactions) ? cached.transactions : [] });
        }
      } catch { await AsyncStorage.removeItem(STORAGE_KEY); }
      finally { setReady(true); }
    })();
  }, []);
  useEffect(() => { if (ready && !started.current) { started.current = true; void refresh(); } }, [ready, refresh]);

  const rows = useMemo<Row[]>(() => {
    const normalized = query.trim().toLocaleLowerCase('en-IN');
    const matched = data.transactions.filter(tx => !normalized || [tx.merchant, tx.category, tx.status, accountName(tx, data.accounts)].some(v => String(v ?? '').toLocaleLowerCase('en-IN').includes(normalized)));
    const months = new Map<string, Transaction[]>();
    for (const tx of matched) { const key = monthKey(tx.occurred_at); const group = months.get(key) ?? []; group.push(tx); months.set(key, group); }
    const result: Row[] = [];
    for (const key of [...months.keys()].sort().reverse()) {
      const group = months.get(key)!; const sum = totals(group, data.transactions);
      result.push({ kind: 'month', key, count: group.length, ...sum });
      for (const tx of group) result.push({ kind: 'transaction', tx });
    }
    return result;
  }, [data.transactions, data.accounts, query]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'month') return <View style={styles.monthHead}>
      <View><Text style={styles.monthTitle}>{monthLabel(item.key)}</Text><Text style={styles.monthCount}>{item.count} transactions{item.unconverted ? ` · ${item.unconverted} missing INR rate` : ''}</Text></View>
      <View style={styles.monthTotals}><Text style={styles.spent}>Spent {formatMoney(item.spent)}</Text><Text style={styles.income}>Earned +{formatMoney(item.income)}</Text></View>
    </View>;
    const tx = item.tx; const credit = tx.direction.toLowerCase() === 'credit'; const debit = tx.direction.toLowerCase() === 'debit';
    const status = tx.status?.toUpperCase();
    return <Pressable accessibilityRole="button" accessibilityLabel={`${titleFor(tx)}, ${credit ? 'received' : 'spent'} ${formatMoney(Math.abs(tx.amount_minor), tx.currency)}. ${dayLabel(tx.occurred_at)}. View details`} onPress={() => setSelected(tx)} style={styles.transaction}>
      <View style={[styles.icon, credit && styles.creditIcon]}><Text style={styles.iconText}>{credit ? '↓' : '↗'}</Text></View>
      <View style={styles.txMiddle}><Text numberOfLines={1} style={styles.merchant}>{titleFor(tx)}</Text><Text numberOfLines={1} style={styles.meta}>{tx.category ? `${tx.category.replace(/_/g, ' ')} · ` : ''}{dayLabel(tx.occurred_at)}</Text></View>
      <View style={styles.amountBlock}><Text style={[styles.amount, credit && styles.creditAmount]}>{credit ? '+' : debit ? '−' : ''}{formatMoney(Math.abs(tx.amount_minor), tx.currency)}</Text>{tx.currency !== 'INR' && rupeeEquivalent(tx) && <Text style={styles.foreignEq}>≈ {rupeeEquivalent(tx)}</Text>}{status && status !== 'POSTED' && <Text style={styles.pending}>{status.toLowerCase()}</Text>}</View>
    </Pressable>;
  }, []);

  const lastSync = data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const detailRows: Array<[string, string]> = selected ? [
    ['Date', new Date(selected.occurred_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })],
    ['Direction', selected.direction],
    ['Account', accountName(selected, data.accounts)], ['Category', selected.category?.replace(/_/g, ' ') || 'Not categorised'],
    ['Status', selected.status || 'Unknown'], ['Transaction ID', selected.id],
    ...Object.entries(selected).filter(([key]) => !['id','account_id','occurred_at','direction','amount_minor','currency','merchant','category','status','updated_at'].includes(key)).map(([key,value]) => [key.replace(/_/g, ' '), typeof value === 'object' ? JSON.stringify(value) : String(value)] as [string,string]),
  ] : [];
  return <SafeAreaProvider><SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <StatusBar barStyle="dark-content" backgroundColor={palette.bg} />
    <View style={styles.topbar}><View><Text style={styles.eyebrow}>SIMPLIFY MONEY</Text><Text style={styles.title}>Track</Text></View><View style={styles.syncBadge}><View style={[styles.dot, syncError && styles.offlineDot]} /><Text style={styles.syncText}>{syncError ? 'Offline' : data.hasSynced ? `Synced ${lastSync}` : 'Syncing'}</Text></View></View>
    <View style={styles.searchBox}><Text style={styles.searchIcon}>⌕</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search transactions" placeholderTextColor="#929c95" returnKeyType="search" accessibilityLabel="Search transactions by merchant" style={styles.search} /><Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}><Text style={styles.clear}>{query ? '×' : ''}</Text></Pressable></View>
    {syncError && data.transactions.length > 0 && <Pressable onPress={() => void refresh()} style={styles.offlineBanner}><Text style={styles.offlineText}>Showing saved transactions · Tap to retry</Text></Pressable>}
    {!ready || (!data.hasSynced && refreshing) ? <View style={styles.loading}><ActivityIndicator size="large" color={palette.green} /><Text style={styles.loadingText}>Loading your transactions…</Text></View> :
      <FlatList data={rows} renderItem={renderRow} keyExtractor={row => row.kind === 'month' ? `month-${row.key}` : `transaction-${row.tx.id}`} stickyHeaderIndices={[]} initialNumToRender={18} maxToRenderPerBatch={20} windowSize={9} removeClippedSubviews refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.green} />} contentContainerStyle={[styles.listContent, rows.length === 0 && styles.emptyList]} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>{query ? '⌕' : '↻'}</Text><Text style={styles.emptyTitle}>{query ? 'No transactions found' : syncError ? 'Couldn’t load transactions' : 'No transactions yet'}</Text><Text style={styles.emptyBody}>{query ? 'Try another merchant or clear your search.' : syncError ? 'Your saved history is safe. Check the server and try again.' : 'Your transaction history will appear here.'}</Text>{syncError && <Pressable onPress={() => void refresh()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>}</View>} />}
    <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
      <Pressable style={styles.scrim} onPress={() => setSelected(null)}><Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
        <View style={styles.grabber} /><View style={styles.detailIcon}><Text style={styles.detailIconText}>{selected?.direction.toLowerCase() === 'credit' ? '↓' : '↗'}</Text></View>
        <Text style={styles.detailMerchant}>{selected ? titleFor(selected) : ''}</Text>
        {selected && <Text style={styles.detailAmount}>{selected.direction.toLowerCase() === 'credit' ? '+' : '−'}{formatMoney(Math.abs(selected.amount_minor), selected.currency)}</Text>}
        <Text style={styles.detailCaption}>TRANSACTION DETAILS</Text>
        {selected && <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailRows}>{selected.currency !== 'INR' && rupeeEquivalent(selected) && <View style={styles.detailRow}><Text style={styles.detailLabel}>INR equivalent</Text><Text style={styles.detailValue}>{rupeeEquivalent(selected)}</Text></View>}{detailRows.map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>)}</ScrollView>}
        <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable>
      </Pressable></Pressable>
    </Modal>
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg }, topbar: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { color: palette.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.7 }, title: { color: palette.ink, fontSize: 32, fontWeight: '800', letterSpacing: -1.2, marginTop: 2 }, syncBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7, gap: 6 }, dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: '#35a574' }, offlineDot: { backgroundColor: palette.orange }, syncText: { color: palette.muted, fontSize: 11, fontWeight: '600' }, searchBox: { marginHorizontal: 18, marginBottom: 10, height: 48, borderRadius: 14, backgroundColor: palette.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: palette.line }, searchIcon: { fontSize: 26, color: palette.muted, marginRight: 8, marginTop: -4 }, search: { flex: 1, color: palette.ink, fontSize: 15, paddingVertical: 0 }, clear: { color: palette.muted, fontSize: 24, paddingHorizontal: 4 }, listContent: { paddingHorizontal: 18, paddingBottom: 34 }, monthHead: { paddingHorizontal: 4, paddingTop: 21, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, monthTitle: { fontWeight: '800', fontSize: 17, color: palette.ink }, monthCount: { fontSize: 11, color: palette.muted, marginTop: 3 }, monthTotals: { alignItems: 'flex-end', gap: 2 }, spent: { fontSize: 12, color: palette.ink, fontWeight: '700' }, income: { fontSize: 11, color: palette.green, fontWeight: '600' }, transaction: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: '#f0f2ef' }, icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' }, creditIcon: { backgroundColor: palette.mint }, iconText: { color: palette.green, fontSize: 19, fontWeight: '700' }, txMiddle: { flex: 1, marginLeft: 11, marginRight: 8 }, merchant: { color: palette.ink, fontSize: 14, fontWeight: '700' }, meta: { color: palette.muted, fontSize: 11, marginTop: 5, textTransform: 'capitalize' }, amountBlock: { alignItems: 'flex-end' }, amount: { color: palette.ink, fontSize: 12, fontWeight: '700' }, creditAmount: { color: palette.green }, foreignEq: { color: palette.muted, fontSize: 9, marginTop: 3 }, pending: { color: palette.orange, fontSize: 9, marginTop: 3, textTransform: 'capitalize' }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }, loadingText: { color: palette.muted, fontSize: 14 }, emptyList: { flexGrow: 1 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, minHeight: 330 }, emptyIcon: { color: palette.green, fontSize: 35, marginBottom: 12 }, emptyTitle: { color: palette.ink, fontSize: 18, fontWeight: '800' }, emptyBody: { color: palette.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 }, retry: { marginTop: 18, backgroundColor: palette.green, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }, retryText: { color: palette.white, fontWeight: '700' }, offlineBanner: { marginHorizontal: 18, marginBottom: 4, borderRadius: 9, padding: 9, backgroundColor: '#fff0e8' }, offlineText: { color: '#8a4829', textAlign: 'center', fontSize: 11, fontWeight: '600' }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13,25,18,0.38)' }, sheet: { backgroundColor: palette.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, maxHeight: '88%' }, grabber: { width: 40, height: 4, borderRadius: 4, backgroundColor: '#d9dfda', alignSelf: 'center', marginBottom: 20 }, detailIcon: { alignSelf: 'center', height: 54, width: 54, borderRadius: 18, backgroundColor: palette.mint, alignItems: 'center', justifyContent: 'center' }, detailIconText: { fontSize: 25, fontWeight: '700', color: palette.green }, detailMerchant: { color: palette.ink, textAlign: 'center', fontSize: 20, fontWeight: '800', marginTop: 12 }, detailAmount: { color: palette.ink, textAlign: 'center', fontSize: 25, fontWeight: '800', marginTop: 5 }, detailCaption: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 25, marginBottom: 7 }, detailScroll: { flexShrink: 1 }, detailRows: { borderTopWidth: 1, borderTopColor: palette.line }, detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.line, gap: 16 }, detailLabel: { color: palette.muted, fontSize: 12, textTransform: 'capitalize', flex: 1 }, detailValue: { color: palette.ink, fontSize: 12, fontWeight: '600', flex: 2, textAlign: 'right' }, done: { marginTop: 17, height: 48, borderRadius: 14, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' }, doneText: { color: palette.white, fontSize: 14, fontWeight: '700' },
});

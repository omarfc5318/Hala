import { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { Avatar } from '../../components/Avatar';
import { CityBadge } from '../../components/CityBadge';
import { EmptyState } from '../../components/EmptyState';
import type { City } from '../../lib/validation';

type FriendshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'accepted';

interface UserResult {
  id: string;
  name: string;
  username: string;
  photo_url: string | null;
  city: City | null;
  status: FriendshipStatus;
}

interface FriendshipEdge {
  requester_id: string;
  addressee_id: string;
  status: string;
}

function resolveStatus(
  myId: string,
  theirId: string,
  edges: FriendshipEdge[],
): FriendshipStatus {
  const edge = edges.find(
    (e) =>
      (e.requester_id === myId && e.addressee_id === theirId) ||
      (e.addressee_id === myId && e.requester_id === theirId),
  );
  if (!edge) return 'none';
  if (edge.status === 'accepted') return 'accepted';
  return edge.requester_id === myId ? 'pending_sent' : 'pending_received';
}

export default function FriendSearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setHasSearched(false); return; }
    setSearching(true);
    setHasSearched(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Fetch matching users (excluding self)
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, name, username, photo_url, city')
        .ilike('username', `%${q.trim()}%`)
        .neq('id', user.id)
        .limit(20);

      if (usersErr) throw usersErr;
      if (!users?.length) { setResults([]); return; }

      // 2. Fetch all my edges with those users in one query
      const userIds = users.map((u) => u.id);
      const { data: edges } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id, status')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

      const relevantEdges = (edges ?? []).filter(
        (e: FriendshipEdge) => userIds.includes(e.requester_id) || userIds.includes(e.addressee_id),
      );

      setResults(
        users.map((u) => ({
          ...u,
          city: u.city as City | null,
          status: resolveStatus(user.id, u.id, relevantEdges as FriendshipEdge[]),
        })),
      );
    } catch (e) {
      logger.error('Friend search failed', e);
      Toast.show({ type: 'error', text1: 'Search failed' });
    } finally {
      setSearching(false);
    }
  }, []);

  function handleQueryChange(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 400);
  }

  async function sendRequest(targetId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('friendships').insert({
        requester_id: user.id,
        addressee_id: targetId,
        status: 'pending',
      });
      if (error) throw error;
      // Optimistically flip status
      setResults((r) =>
        r.map((u) => u.id === targetId ? { ...u, status: 'pending_sent' } : u),
      );
    } catch (e) {
      logger.error('Send friend request failed', e);
      Toast.show({ type: 'error', text1: 'Failed to send request' });
    }
  }

  function ActionButton({ item }: { item: UserResult }) {
    if (item.status === 'accepted') {
      return (
        <View style={btn.friends}>
          <Text style={btn.friendsText}>Friends</Text>
        </View>
      );
    }
    if (item.status === 'pending_sent' || item.status === 'pending_received') {
      return (
        <View style={btn.pending}>
          <Text style={btn.pendingText}>Pending</Text>
        </View>
      );
    }
    return (
      <Pressable style={btn.add} onPress={() => sendRequest(item.id)}>
        <Text style={btn.addText}>Add</Text>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Search bar */}
      <View style={s.searchRow}>
        <Ionicons name="search" size={18} color={theme.MUTED} />
        <TextInput
          style={s.input}
          placeholder="Search by username"
          placeholderTextColor={theme.MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={handleQueryChange}
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={theme.MUTED} />}
        {query.length > 0 && !searching && (
          <Pressable onPress={() => { setQuery(''); setResults([]); setHasSearched(false); }} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={theme.MUTED} />
          </Pressable>
        )}
      </View>

      {/* Results */}
      {hasSearched && results.length === 0 && !searching ? (
        <EmptyState title="No users found" subtitle={`Nobody with "@${query.trim()}" in their username.`} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(u) => u.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Avatar uri={item.photo_url} name={item.name} size={44} />
              <View style={s.rowText}>
                <Text style={s.rowName}>{item.name}</Text>
                <Text style={s.rowUsername}>@{item.username}</Text>
                <CityBadge city={item.city} />
              </View>
              <ActionButton item={item} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    height: 48,
    backgroundColor: theme.SURFACE,
    borderRadius: 999,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  input: { flex: 1, fontSize: 15, color: theme.TEXT },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: theme.SURFACE,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '700', color: theme.TEXT },
  rowUsername: { fontSize: 12, color: theme.MUTED },
});

const btn = StyleSheet.create({
  add: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
  },
  addText: { fontSize: 13, fontWeight: '700', color: theme.BG },
  pending: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: theme.SURFACE,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  pendingText: { fontSize: 13, fontWeight: '600', color: theme.MUTED },
  friends: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.SUCCESS,
  },
  friendsText: { fontSize: 13, fontWeight: '700', color: theme.SUCCESS },
});

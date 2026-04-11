import { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { Avatar } from '../../components/Avatar';
import { CityBadge } from '../../components/CityBadge';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import type { City } from '../../lib/validation';

interface Friend {
  friendshipId: string;
  id: string;
  name: string;
  username: string;
  photo_url: string | null;
  city: City | null;
}

export default function FriendsScreen() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => { loadFriends(); }, []);

  async function loadFriends() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch both directions then merge — the DB has two FK cols (requester/addressee)
      const [sentRes, receivedRes, pendingRes] = await Promise.all([
        withRetry(() =>
          supabase.from('friendships')
            .select('id, addressee:users!addressee_id(id, name, username, photo_url, city)')
            .eq('requester_id', user.id)
            .eq('status', 'accepted'),
        ),
        withRetry(() =>
          supabase.from('friendships')
            .select('id, requester:users!requester_id(id, name, username, photo_url, city)')
            .eq('addressee_id', user.id)
            .eq('status', 'accepted'),
        ),
        withRetry(() =>
          supabase.from('friendships')
            .select('*', { count: 'exact', head: true })
            .eq('addressee_id', user.id)
            .eq('status', 'pending'),
        ),
      ]);

      const list: Friend[] = [
        ...((sentRes.data ?? []) as any[]).map((r) => ({ friendshipId: r.id, ...r.addressee })),
        ...((receivedRes.data ?? []) as any[]).map((r) => ({ friendshipId: r.id, ...r.requester })),
      ];
      setFriends(list);
      setPendingCount(pendingRes.count ?? 0);
    } catch (e) {
      logger.error('Failed to load friends', e);
    } finally {
      setLoading(false);
    }
  }

  // Client-side filter — no network call needed for the search bar
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q),
    );
  }, [query, friends]);

  return (
    <SafeAreaView style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.heading}>Friends</Text>
        <View style={s.headerActions}>
          {pendingCount > 0 && (
            <Pressable style={s.requestsBtn} onPress={() => router.push('/friends/requests')}>
              <Text style={s.requestsBtnText}>
                {pendingCount} request{pendingCount > 1 ? 's' : ''}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/friends/search')} hitSlop={8}>
            <Ionicons name="person-add-outline" size={24} color={theme.PRIMARY} />
          </Pressable>
        </View>
      </View>

      {/* Search bar — client-side filter */}
      {!loading && friends.length > 0 && (
        <View style={s.searchRow}>
          <Ionicons name="search" size={16} color={theme.MUTED} />
          <TextInput
            style={s.searchInput}
            placeholder="Filter friends…"
            placeholderTextColor={theme.MUTED}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={theme.MUTED} />
            </Pressable>
          )}
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={s.listPad}>
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} height={60} />)}
        </View>
      ) : filtered.length === 0 && friends.length === 0 ? (
        <EmptyState
          title="No friends yet"
          subtitle="Find friends to see their restaurant picks."
          icon={
            <Pressable style={s.findBtn} onPress={() => router.push('/friends/search')}>
              <Text style={s.findBtnText}>Find friends</Text>
            </Pressable>
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(f) => f.friendshipId}
          contentContainerStyle={s.listPad}
          renderItem={({ item }) => (
            <Pressable
              style={s.row}
              onPress={() => router.push(`/friends/${item.id}`)}
            >
              <Avatar uri={item.photo_url} name={item.name} size={44} />
              <View style={s.rowText}>
                <Text style={s.rowName}>{item.name}</Text>
                <Text style={s.rowUsername}>@{item.username}</Text>
              </View>
              <CityBadge city={item.city} />
              <Ionicons name="chevron-forward" size={16} color={theme.MUTED} style={{ marginLeft: 4 }} />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={s.noMatch}>No results for "{query}"</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  heading: { fontSize: 22, fontWeight: '800', color: theme.TEXT },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestsBtn: {
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  requestsBtnText: { fontSize: 12, fontWeight: '700', color: theme.BG },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    height: 40,
    backgroundColor: theme.SURFACE,
    borderRadius: 999,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  searchInput: { flex: 1, fontSize: 14, color: theme.TEXT },
  listPad: { padding: 16, gap: 8, flexGrow: 1 },
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
  noMatch: { textAlign: 'center', color: theme.MUTED, marginTop: 32 },
  findBtn: {
    marginTop: 12,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  findBtnText: { color: theme.BG, fontWeight: '700', fontSize: 15 },
});

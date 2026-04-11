import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { measure } from '../../lib/perf';
import { Avatar } from '../../components/Avatar';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import type { City } from '../../lib/validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Filter = 'all' | 'riyadh' | 'dubai' | 'friends';

interface Eatery {
  id: string;
  name: string;
  location_text: string;
  photos: string[];
  city: City | null;
}

interface FriendReviewInfo {
  count: number;
  topDish: string | null;
  avatarUris: string[];
}

interface RecentItem {
  eateryId: string;
  eateryName: string;
  eateryPhoto: string | null;
  friendAvatars: string[];
  friendCount: number;
}

const PAGE_SIZE = 20;
const SCREEN_W = Dimensions.get('window').width;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'riyadh', label: 'Riyadh 🇸🇦' },
  { id: 'dubai', label: 'Dubai 🇦🇪' },
  { id: 'friends', label: 'Friends only' },
];

// ---------------------------------------------------------------------------
// Sub-components (inline to keep file count manageable)
// ---------------------------------------------------------------------------

function AvatarStack({ uris, names }: { uris: string[]; names: string[] }) {
  const visible = uris.slice(0, 3);
  return (
    <View style={{ flexDirection: 'row' }}>
      {visible.map((uri, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }}>
          <Avatar uri={uri || null} name={names[i] ?? '?'} size={24} />
        </View>
      ))}
    </View>
  );
}

function FriendRecentCard({ item, onPress }: { item: RecentItem; onPress: () => void }) {
  return (
    <Pressable style={rc.card} onPress={onPress}>
      {item.eateryPhoto ? (
        <Image source={{ uri: item.eateryPhoto }} style={rc.photo} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[rc.photo, rc.photoPlaceholder]} />
      )}
      <Text style={rc.name} numberOfLines={2}>{item.eateryName}</Text>
      <View style={rc.footer}>
        <AvatarStack uris={item.friendAvatars} names={item.friendAvatars.map(() => '?')} />
        <Text style={rc.count}>{item.friendCount} friend{item.friendCount > 1 ? 's' : ''}</Text>
      </View>
    </Pressable>
  );
}

const rc = StyleSheet.create({
  card: { width: 130, marginRight: 12, gap: 6 },
  photo: { width: 130, height: 120, borderRadius: 16 },
  photoPlaceholder: { backgroundColor: theme.BORDER },
  name: { fontSize: 13, fontWeight: '700', color: theme.TEXT, lineHeight: 17 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { fontSize: 11, fontWeight: '600', color: theme.PRIMARY },
});

function EateryListCard({
  eatery,
  friendInfo,
  onPress,
}: {
  eatery: Eatery;
  friendInfo?: FriendReviewInfo;
  onPress: () => void;
}) {
  const photo = eatery.photos?.[0] ?? null;
  return (
    <Pressable style={ec.card} onPress={onPress}>
      {photo ? (
        <Image source={{ uri: photo }} style={ec.photo} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[ec.photo, ec.photoPlaceholder]}>
          <Ionicons name="restaurant-outline" size={32} color={theme.BORDER} />
        </View>
      )}

      <View style={ec.body}>
        <View style={ec.row}>
          <Text style={ec.name} numberOfLines={1}>{eatery.name}</Text>
          {friendInfo && friendInfo.count > 0 && (
            <View style={ec.badge}>
              <Text style={ec.badgeText}>{friendInfo.count} friend{friendInfo.count > 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>
        <Text style={ec.location} numberOfLines={1}>{eatery.location_text}</Text>
        {friendInfo?.topDish && (
          <Text style={ec.dish} numberOfLines={1}>"{friendInfo.topDish}"</Text>
        )}
      </View>
    </Pressable>
  );
}

const ec = StyleSheet.create({
  card: { backgroundColor: theme.BG, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.BORDER },
  photo: { width: '100%', height: 200 },
  photoPlaceholder: { backgroundColor: theme.SURFACE, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 12, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: theme.TEXT },
  badge: { backgroundColor: theme.PRIMARY, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: theme.BG },
  location: { fontSize: 13, color: theme.MUTED },
  dish: { fontSize: 12, color: theme.PRIMARY, fontStyle: 'italic' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [eateries, setEateries] = useState<Eatery[]>([]);
  const [friendReviewMap, setFriendReviewMap] = useState<Map<string, FriendReviewInfo>>(new Map());
  const [friendsRecent, setFriendsRecent] = useState<RecentItem[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [friendReviewedIds, setFriendReviewedIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const currentUserIdRef = useRef<string | null>(null);

  // ── Boot: get user + friend data once ─────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      currentUserIdRef.current = user.id;
      await initFriendData(user.id);
    })();
  }, []);

  async function initFriendData(uid: string) {
    try {
      // Single query for all accepted friendship edges — map to friend ID array client-side
      const { data: edges } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
        .eq('status', 'accepted');

      const ids = (edges ?? []).map((e) =>
        e.requester_id === uid ? e.addressee_id : e.requester_id,
      );
      setFriendIds(ids);

      if (ids.length === 0) return;

      // One query for recent friend reviews — drives both the Recent section
      // and the "N friends been here" counts
      const { data: recentReviews } = await supabase
        .from('reviews')
        .select('eatery_id, favourite_dish, eateries(id, name, photos), users(id, name, photo_url)')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .limit(60); // enough to cover 6 recent eateries + friend review counts

      if (!recentReviews?.length) return;

      // Build friend review map (eateryId → { count, topDish, avatarUris })
      const map = new Map<string, FriendReviewInfo>();
      const seenEateries = new Map<string, RecentItem>();

      for (const r of recentReviews as any[]) {
        const eid = r.eatery_id;
        const existing = map.get(eid);
        if (existing) {
          existing.count++;
          if (!existing.topDish && r.favourite_dish) existing.topDish = r.favourite_dish;
          if (existing.avatarUris.length < 3 && r.users?.photo_url) {
            existing.avatarUris.push(r.users.photo_url);
          }
        } else {
          map.set(eid, {
            count: 1,
            topDish: r.favourite_dish ?? null,
            avatarUris: r.users?.photo_url ? [r.users.photo_url] : [],
          });
        }

        if (!seenEateries.has(eid) && seenEateries.size < 6) {
          seenEateries.set(eid, {
            eateryId: eid,
            eateryName: r.eateries?.name ?? '',
            eateryPhoto: r.eateries?.photos?.[0] ?? null,
            friendAvatars: r.users?.photo_url ? [r.users.photo_url] : [],
            friendCount: 1,
          });
        }
      }

      setFriendReviewMap(map);
      setFriendReviewedIds([...map.keys()]);
      setFriendsRecent([...seenEateries.values()]);
    } catch (e) {
      logger.error('Failed to load friend data', e);
    }
  }

  // ── Reload on filter / search change ──────────────────────────────────────

  useEffect(() => {
    loadEateries(0, true);
  }, [activeFilter, debouncedQuery, friendReviewedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleQueryChange(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 300);
  }

  // ── Paginated eatery fetch ─────────────────────────────────────────────────

  async function loadEateries(pageNum: number, reset: boolean) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    // Wrap initial page loads in a Sentry 'feed.load' transaction
    const run = () => _loadEateries(pageNum, reset);
    if (reset) {
      await measure('feed.load', 'navigation', run);
    } else {
      await run();
    }
  }

  async function _loadEateries(pageNum: number, reset: boolean) {
    try {
      let q = supabase
        .from('eateries')
        .select('id, name, location_text, photos, city')
        .order('created_at', { ascending: false })
        .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1);

      if (activeFilter === 'riyadh') q = q.eq('city', 'riyadh');
      else if (activeFilter === 'dubai') q = q.eq('city', 'dubai');
      else if (activeFilter === 'friends' && friendReviewedIds.length > 0) {
        q = q.in('id', friendReviewedIds);
      } else if (activeFilter === 'friends' && friendReviewedIds.length === 0) {
        // No friends / no friend reviews — show empty
        setEateries([]);
        setHasMore(false);
        return;
      }

      if (debouncedQuery.trim().length >= 2) {
        q = q.ilike('name', `%${debouncedQuery.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      const batch = (data ?? []) as Eatery[];

      // Batch-load friend review info for this page in one query
      if (batch.length > 0 && friendIds.length > 0) {
        const batchIds = batch.map((e) => e.id);
        const { data: batchReviews } = await supabase
          .from('reviews')
          .select('eatery_id, favourite_dish, users(photo_url)')
          .in('user_id', friendIds)
          .in('eatery_id', batchIds);

        if (batchReviews?.length) {
          const updatedMap = new Map(friendReviewMap);
          for (const r of batchReviews as any[]) {
            const eid = r.eatery_id;
            if (!updatedMap.has(eid)) {
              updatedMap.set(eid, {
                count: 1,
                topDish: r.favourite_dish ?? null,
                avatarUris: r.users?.photo_url ? [r.users.photo_url] : [],
              });
            }
          }
          setFriendReviewMap(updatedMap);
        }
      }

      setHasMore(batch.length === PAGE_SIZE);
      setPage(pageNum);
      setEateries(reset ? batch : (prev) => [...prev, ...batch]);
    } catch (e) {
      logger.error('Failed to load eateries', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    loadEateries(page + 1, false);
  }, [hasMore, loadingMore, loading, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Search bar */}
      <View style={s.searchRow} accessibilityRole="search">
        <Ionicons name="search" size={18} color={theme.MUTED} accessibilityElementsHidden />
        <TextInput
          style={s.searchInput}
          placeholder="Search restaurants…"
          placeholderTextColor={theme.MUTED}
          value={query}
          onChangeText={handleQueryChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search restaurants"
          accessibilityHint="Type to filter restaurants by name"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => { setQuery(''); setDebouncedQuery(''); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={theme.MUTED} />
          </Pressable>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chips}
        accessibilityRole="tablist"
        accessibilityLabel="City filter"
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            style={[s.chip, activeFilter === f.id && s.chipActive]}
            onPress={() => setActiveFilter(f.id)}
            accessibilityRole="tab"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: activeFilter === f.id }}
          >
            <Text style={[s.chipText, activeFilter === f.id && s.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.pad}>{[1, 2, 3].map((i) => <SkeletonCard key={i} height={260} />)}</View>
      ) : (
        <FlatList
          data={eateries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={s.pad}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            friendsRecent.length > 0 && activeFilter !== 'riyadh' && activeFilter !== 'dubai' ? (
              <View style={s.recentSection}>
                <Text style={s.sectionTitle}>Friends' Recent</Text>
                <FlatList
                  horizontal
                  data={friendsRecent}
                  keyExtractor={(r) => r.eateryId}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 4 }}
                  renderItem={({ item }) => (
                    <FriendRecentCard
                      item={item}
                      onPress={() => router.push(`/eatery/${item.eateryId}`)}
                    />
                  )}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <EateryListCard
              eatery={item}
              friendInfo={friendReviewMap.get(item.id)}
              onPress={() => router.push(`/eatery/${item.id}`)}
            />
          )}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={theme.PRIMARY} style={{ marginVertical: 16 }} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="No eateries found"
              subtitle={debouncedQuery ? `Nothing matching "${debouncedQuery}"` : 'Be the first to add one!'}
              icon={
                <Pressable style={s.addBtn} onPress={() => router.push('/eatery/add')}>
                  <Text style={s.addBtnText}>Add this eatery</Text>
                </Pressable>
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    height: 46,
    backgroundColor: theme.SURFACE,
    borderRadius: 999,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  searchInput: { flex: 1, fontSize: 15, color: theme.TEXT },
  chips: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.SURFACE,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  chipActive: { backgroundColor: theme.PRIMARY, borderColor: theme.PRIMARY },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.MUTED },
  chipTextActive: { color: theme.BG },
  pad: { padding: 16, gap: 12, flexGrow: 1 },
  recentSection: { marginBottom: 16, gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: theme.TEXT },
  addBtn: {
    marginTop: 12,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  addBtnText: { color: theme.BG, fontWeight: '700', fontSize: 15 },
});

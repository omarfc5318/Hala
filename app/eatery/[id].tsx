import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  Linking,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { relativeTime } from '../../lib/format';
import { Avatar } from '../../components/Avatar';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import { ReportSheet, type ReportSheetRef } from '../../components/ReportSheet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Eatery {
  id: string;
  name: string;
  location_text: string;
  photos: string[];
  website: string | null;
  menu_url: string | null;
  city: string | null;
}

interface ReviewRow {
  id: string;
  rank: number;
  text: string | null;
  favourite_dish: string | null;
  created_at: string;
  user_id: string;
  users: {
    id: string;
    name: string;
    username: string;
    photo_url: string | null;
  };
}

const SCREEN_W = Dimensions.get('window').width;
const MAX_PHOTOS = 5;

// ---------------------------------------------------------------------------
// Photo carousel
// ---------------------------------------------------------------------------

function PhotoCarousel({ photos }: { photos: string[] }) {
  const [index, setIndex] = useState(0);
  const visible = photos.slice(0, MAX_PHOTOS);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = e.nativeEvent.contentOffset.x;
    setIndex(Math.round(x / SCREEN_W));
  }

  if (!visible.length) {
    return (
      <View style={[ph.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="restaurant-outline" size={48} color={theme.BORDER} />
      </View>
    );
  }

  return (
    <View>
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={visible}
        keyExtractor={(_, i) => i.toString()}
        onMomentumScrollEnd={onScroll}
        renderItem={({ item }) => (
          <Image source={{ uri: item }} style={ph.photo} contentFit="cover" cachePolicy="memory-disk" />
        )}
      />
      {visible.length > 1 && (
        <View style={ph.dots}>
          {visible.map((_, i) => (
            <View key={i} style={[ph.dot, i === index && ph.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const ph = StyleSheet.create({
  container: { width: SCREEN_W, height: 280, backgroundColor: theme.SURFACE },
  photo: { width: SCREEN_W, height: 280 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.BORDER },
  dotActive: { backgroundColor: theme.PRIMARY, width: 18 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function EateryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [eatery, setEatery] = useState<Eatery | null>(null);
  const [friendReviews, setFriendReviews] = useState<ReviewRow[]>([]);
  const [allReviews, setAllReviews] = useState<ReviewRow[]>([]);
  const [showingFriendReviews, setShowingFriendReviews] = useState(true);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const myIdRef     = useRef<string | null>(null);
  const reportRef   = useRef<ReportSheetRef>(null);

  useEffect(() => { loadAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      myIdRef.current = user.id;

      // Get friend IDs in one query
      const { data: edges } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted');

      const ids = (edges ?? []).map((e) =>
        e.requester_id === user.id ? e.addressee_id : e.requester_id,
      );
      setFriendIds(ids);

      // Load eatery + friend reviews in parallel
      const [eateryRes, friendRevRes] = await Promise.all([
        withRetry(() => supabase.from('eateries').select('*').eq('id', id).single()),
        ids.length > 0
          ? supabase
              .from('reviews')
              .select('id, rank, text, favourite_dish, created_at, user_id, users(id, name, username, photo_url)')
              .eq('eatery_id', id)
              .in('user_id', ids)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (eateryRes.error) throw eateryRes.error;
      setEatery(eateryRes.data as Eatery);

      const fReviews = (friendRevRes.data ?? []) as unknown as ReviewRow[];
      setFriendReviews(fReviews);

      // If no friend reviews, load all reviews as fallback
      if (fReviews.length === 0) {
        const { data: all } = await supabase
          .from('reviews')
          .select('id, rank, text, favourite_dish, created_at, user_id, users(id, name, username, photo_url)')
          .eq('eatery_id', id)
          .order('created_at', { ascending: false })
          .limit(20);
        setAllReviews((all ?? []) as unknown as ReviewRow[]);
        setShowingFriendReviews(false);
      }
    } catch (e) {
      logger.error('Failed to load eatery detail', e);
      Toast.show({ type: 'error', text1: 'Failed to load eatery' });
    } finally {
      setLoading(false);
    }
  }

  function fileReport() {
    if (!id) return;
    reportRef.current?.open({ entityType: 'eatery', entityId: id });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading || !eatery) {
    return (
      <SafeAreaView style={s.root}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={theme.TEXT} />
        </Pressable>
        <View style={s.pad}>{[280, 60, 80, 80].map((h, i) => <SkeletonCard key={i} height={h} />)}</View>
      </SafeAreaView>
    );
  }

  const displayedReviews = showingFriendReviews ? friendReviews : allReviews;
  const whoLabel = buildWhoLabel(friendReviews);

  return (
    <View style={s.root}>
      <FlatList
        data={displayedReviews}
        keyExtractor={(r) => r.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListHeaderComponent={
          <>
            {/* Back button over photo */}
            <View style={s.photoWrap}>
              <PhotoCarousel photos={eatery.photos ?? []} />
              <Pressable style={s.backOverlay} onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
            </View>

            {/* Info */}
            <View style={s.info}>
              <Text style={s.title}>{eatery.name}</Text>
              <Text style={s.location}>{eatery.location_text}</Text>

              <View style={s.links}>
                {eatery.website && (
                  <Pressable onPress={() => Linking.openURL(eatery.website!)}>
                    <Text style={s.link}>Website</Text>
                  </Pressable>
                )}
                {eatery.menu_url && (
                  <Pressable onPress={() => Linking.openURL(eatery.menu_url!)}>
                    <Text style={s.link}>Menu</Text>
                  </Pressable>
                )}
              </View>

              {/* Leave a review */}
              <Pressable
                style={s.reviewBtn}
                onPress={() =>
                  router.push(
                    `/eatery/review?eateryId=${id}&eateryName=${encodeURIComponent(eatery.name)}`,
                  )
                }
              >
                <Ionicons name="star-outline" size={16} color={theme.BG} />
                <Text style={s.reviewBtnText}>Leave a review</Text>
              </Pressable>
            </View>

            {/* Friends who've been here */}
            {friendReviews.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Friends who've been here</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                  <View style={s.avatarRow}>
                    {friendReviews.map((r) => (
                      <Pressable
                        key={r.user_id}
                        style={s.avatarItem}
                        onPress={() => router.push(`/friends/${r.user_id}`)}
                      >
                        <Avatar uri={r.users.photo_url} name={r.users.name} size={44} />
                        <Text style={s.avatarName} numberOfLines={1}>{r.users.username}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {whoLabel && <Text style={s.whoLabel}>{whoLabel}</Text>}
              </View>
            )}

            {/* Reviews header */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {showingFriendReviews ? "Friends' reviews" : 'All reviews'}
              </Text>
              {!showingFriendReviews && friendReviews.length === 0 && (
                <Text style={s.noFriendsNote}>No friends have reviewed this yet</Text>
              )}
            </View>
          </>
        }
        renderItem={({ item }) => (
          <ReviewItem
            review={item}
            eateryId={id}
            onReport={() => reportRef.current?.open({ entityType: 'review', entityId: item.id })}
          />
        )}
        ListEmptyComponent={<EmptyState title="No reviews yet" subtitle="Be the first!" />}
      />

      {/* Flag (report eatery) button — floating bottom-right */}
      <Pressable
        style={s.flagBtn}
        onPress={fileReport}
        accessibilityRole="button"
        accessibilityLabel="Report this eatery"
      >
        <Ionicons name="flag-outline" size={20} color={theme.MUTED} />
      </Pressable>

      {/* Single shared ReportSheet instance for the whole screen */}
      <ReportSheet ref={reportRef} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ReviewItem
// ---------------------------------------------------------------------------

function ReviewItem({
  review,
  eateryId,
  onReport,
}: {
  review: ReviewRow;
  eateryId: string;
  onReport: () => void;
}) {
  return (
    <View style={ri.card}>
      <View style={ri.header}>
        <Pressable onPress={() => router.push(`/friends/${review.user_id}`)}>
          <Avatar uri={review.users?.photo_url} name={review.users?.name ?? '?'} size={40} />
        </Pressable>
        <View style={ri.headerText}>
          <Text style={ri.name}>{review.users?.name}</Text>
          <Text style={ri.meta}>
            #{review.rank} for @{review.users?.username} · {relativeTime(review.created_at)}
          </Text>
        </View>
        <Pressable
          onPress={onReport}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Report this review"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={theme.MUTED} />
        </Pressable>
      </View>

      {review.text && <Text style={ri.body}>{review.text}</Text>}

      {review.favourite_dish && (
        <View style={ri.dishChip}>
          <Text style={ri.dishText}>{review.favourite_dish}</Text>
        </View>
      )}
    </View>
  );
}

const ri = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    backgroundColor: theme.SURFACE,
    borderRadius: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700', color: theme.TEXT },
  meta: { fontSize: 12, color: theme.MUTED },
  body: { fontSize: 14, color: theme.TEXT, lineHeight: 20 },
  dishChip: {
    alignSelf: 'flex-start',
    backgroundColor: theme.PRIMARY_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dishText: { fontSize: 12, fontWeight: '600', color: theme.PRIMARY },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWhoLabel(reviews: ReviewRow[]): string | null {
  if (!reviews.length) return null;
  const names = reviews.map((r) => r.users?.name?.split(' ')[0] ?? 'Someone');
  if (names.length === 1) return `${names[0]} reviewed this`;
  if (names.length === 2) return `${names[0]} and ${names[1]} reviewed this`;
  return `${names[0]} and ${names.length - 1} others reviewed this`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  pad: { padding: 16, gap: 12 },
  photoWrap: { position: 'relative' },
  backOverlay: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: { padding: 16 },
  info: { padding: 20, gap: 8 },
  title: { fontSize: 24, fontWeight: '800', color: theme.TEXT, letterSpacing: -0.5 },
  location: { fontSize: 14, color: theme.MUTED },
  links: { flexDirection: 'row', gap: 16 },
  link: { fontSize: 14, color: theme.PRIMARY, fontWeight: '600' },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 50,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    marginTop: 4,
  },
  reviewBtnText: { fontSize: 16, fontWeight: '700', color: theme.BG },
  section: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.TEXT },
  noFriendsNote: { fontSize: 13, color: theme.MUTED },
  avatarRow: { flexDirection: 'row', gap: 16 },
  avatarItem: { alignItems: 'center', gap: 4, width: 52 },
  avatarName: { fontSize: 10, color: theme.MUTED, textAlign: 'center' },
  whoLabel: { fontSize: 13, color: theme.PRIMARY, fontWeight: '500' },
  flagBtn: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.SURFACE,
    borderWidth: 1,
    borderColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
});

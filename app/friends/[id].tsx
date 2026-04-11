import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { Avatar } from '../../components/Avatar';
import { CityBadge } from '../../components/CityBadge';
import { ReviewCard, type ReviewCardData } from '../../components/ReviewCard';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import type { City } from '../../lib/validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FriendProfile {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  city: City | null;
  photo_url: string | null;
  is_public: boolean;
}

interface Stats {
  friendsCount: number;
  reviewsCount: number;
  avgRank: number;
}

type RelationStatus = 'self' | 'accepted' | 'pending_sent' | 'pending_received' | 'none';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FriendProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [me, setMe] = useState<string | null>(null);
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<ReviewCardData[]>([]);
  const [relation, setRelation] = useState<RelationStatus>('none');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { loadAll(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoadingProfile(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMe(user.id);

      const [profileRes, friendshipRes, statsRes] = await Promise.all([
        withRetry(() => supabase.from('users').select('*').eq('id', id).single()),
        withRetry(() =>
          supabase.from('friendships').select('requester_id, addressee_id, status')
            .or(
              `and(requester_id.eq.${user.id},addressee_id.eq.${id}),` +
              `and(addressee_id.eq.${user.id},requester_id.eq.${id})`,
            )
            .maybeSingle(),
        ),
        withRetry(() =>
          supabase.from('friendships').select('*', { count: 'exact', head: true })
            .eq('status', 'accepted')
            .or(`requester_id.eq.${id},addressee_id.eq.${id}`),
        ),
      ]);

      if (profileRes.error) throw profileRes.error;
      const p = profileRes.data as FriendProfile;
      setProfile(p);

      // Resolve relation
      const edge = friendshipRes.data as { requester_id: string; addressee_id: string; status: string } | null;
      if (user.id === id) {
        setRelation('self');
      } else if (!edge) {
        setRelation('none');
      } else if (edge.status === 'accepted') {
        setRelation('accepted');
      } else if (edge.requester_id === user.id) {
        setRelation('pending_sent');
      } else {
        setRelation('pending_received');
      }

      const isAccepted = edge?.status === 'accepted';
      const canViewReviews = p.is_public || isAccepted || user.id === id;

      // Stats
      const rankRes = canViewReviews
        ? await supabase.from('reviews').select('rank').eq('user_id', id)
        : { data: [] };
      const rankData = (rankRes.data ?? []) as { rank: number }[];
      const reviewCount = rankData.length;
      setStats({
        friendsCount: statsRes.count ?? 0,
        reviewsCount: reviewCount,
        avgRank: reviewCount ? rankData.reduce((s, r) => s + r.rank, 0) / reviewCount : 0,
      });

      if (canViewReviews) loadReviews(id);
    } catch (e) {
      logger.error('Failed to load friend profile', e);
      Toast.show({ type: 'error', text1: 'Failed to load profile' });
    } finally {
      setLoadingProfile(false);
    }
  }

  async function loadReviews(userId: string) {
    setLoadingReviews(true);
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('reviews')
          .select('id, rank, text, favourite_dish, eatery:eateries(id, name, photos)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      );
      if (error) throw error;
      setReviews((data ?? []) as unknown as ReviewCardData[]);
    } catch (e) {
      logger.error('Failed to load friend reviews', e);
    } finally {
      setLoadingReviews(false);
    }
  }

  async function handleAddFriend() {
    if (!me || !id) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.from('friendships').insert({
        requester_id: me,
        addressee_id: id,
        status: 'pending',
      });
      if (error) throw error;
      setRelation('pending_sent');
      Toast.show({ type: 'success', text1: 'Friend request sent!' });
    } catch (e) {
      logger.error('Add friend failed', e);
      Toast.show({ type: 'error', text1: 'Could not send friend request' });
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingProfile || !profile) {
    return (
      <SafeAreaView style={s.root}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={theme.TEXT} />
        </Pressable>
        <View style={s.pad}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} height={i === 1 ? 80 : 50} />)}
        </View>
      </SafeAreaView>
    );
  }

  const isAccepted = relation === 'accepted';
  const canView = profile.is_public || isAccepted || relation === 'self';
  const avgRankDisplay = stats && stats.avgRank > 0 ? `#${stats.avgRank.toFixed(1)}` : '--';

  return (
    <View style={s.root}>
      <FlatList
        data={canView ? reviews : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.listContent}
        ListHeaderComponent={
          <SafeAreaView>
            {/* Back + action button row */}
            <View style={s.topBar}>
              <Pressable onPress={() => router.back()} hitSlop={8}>
                <Ionicons name="chevron-back" size={24} color={theme.TEXT} />
              </Pressable>

              {relation !== 'self' && (
                actionLoading ? (
                  <ActivityIndicator color={theme.PRIMARY} />
                ) : relation === 'accepted' ? (
                  <View style={s.friendsChip}>
                    <Ionicons name="checkmark" size={14} color={theme.SUCCESS} />
                    <Text style={s.friendsText}>Friends</Text>
                  </View>
                ) : relation === 'pending_sent' ? (
                  <View style={s.pendingChip}>
                    <Text style={s.pendingText}>Pending</Text>
                  </View>
                ) : (
                  <Pressable style={s.addBtn} onPress={handleAddFriend}>
                    <Text style={s.addBtnText}>Add friend</Text>
                  </Pressable>
                )
              )}
            </View>

            {/* Profile header */}
            <View style={s.header}>
              <Avatar uri={profile.photo_url} name={profile.name} size={80} />
              <Text style={s.name}>{profile.name}</Text>
              <Text style={s.username}>@{profile.username}</Text>
              {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
              <CityBadge city={profile.city} size="md" />
            </View>

            {/* Stats */}
            {stats && (
              <View style={s.statsRow}>
                {[
                  { value: stats.friendsCount.toString(), label: 'Friends' },
                  { value: stats.reviewsCount.toString(), label: 'Reviews' },
                  { value: avgRankDisplay, label: 'Rank' },
                ].map(({ value, label }, i) => (
                  <View key={i} style={s.statCol}>
                    <Text style={s.statValue}>{value}</Text>
                    <Text style={s.statLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Section title */}
            {canView && <Text style={s.sectionTitle}>Reviews</Text>}
          </SafeAreaView>
        }
        renderItem={({ item }) => (
          <ReviewCard review={item} onPress={() => router.push(`/eatery/${item.eatery.id}`)} />
        )}
        ListEmptyComponent={
          !canView ? (
            // Private profile — locked state
            <View style={s.locked}>
              <Ionicons name="lock-closed" size={40} color={theme.MUTED} />
              <Text style={s.lockedTitle}>This profile is private</Text>
              <Text style={s.lockedSub}>Add {profile.name} as a friend to see their reviews.</Text>
              {relation === 'none' && (
                <Pressable style={s.addBtn} onPress={handleAddFriend} disabled={actionLoading}>
                  <Text style={s.addBtnText}>
                    {actionLoading ? 'Sending…' : 'Add friend'}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : loadingReviews ? (
            <ActivityIndicator color={theme.PRIMARY} style={{ marginTop: 24 }} />
          ) : (
            <EmptyState title="No reviews yet" />
          )
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  pad: { padding: 16, gap: 12 },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: { padding: 16 },
  header: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 20, gap: 6 },
  name: { fontSize: 20, fontWeight: '800', color: theme.TEXT, marginTop: 8 },
  username: { fontSize: 14, color: theme.MUTED },
  bio: { fontSize: 13, color: theme.TEXT, textAlign: 'center', lineHeight: 18 },

  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.BORDER,
    marginBottom: 16,
  },
  statCol: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', color: theme.TEXT },
  statLabel: { fontSize: 11, color: theme.MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.TEXT, marginBottom: 4 },

  // Relation chips
  friendsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.SUCCESS,
  },
  friendsText: { fontSize: 13, fontWeight: '700', color: theme.SUCCESS },
  pendingChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.SURFACE,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  pendingText: { fontSize: 13, fontWeight: '600', color: theme.MUTED },
  addBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: theme.BG },

  // Locked state
  locked: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 48, gap: 10 },
  lockedTitle: { fontSize: 17, fontWeight: '700', color: theme.TEXT, textAlign: 'center' },
  lockedSub: { fontSize: 14, color: theme.MUTED, textAlign: 'center', lineHeight: 20 },
});

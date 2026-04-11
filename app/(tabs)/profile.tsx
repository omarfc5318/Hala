import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { nameSchema, bioSchema, citySchema, type City } from '../../lib/validation';
import { uploadAvatar } from '../../lib/storage';
import { Avatar } from '../../components/Avatar';
import { CityBadge } from '../../components/CityBadge';
import { ReviewCard, type ReviewCardData } from '../../components/ReviewCard';
import { EateryPhotoCard, type EateryCardData } from '../../components/EateryPhotoCard';
import { EmptyState } from '../../components/EmptyState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
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

type ActiveTab = 'reviews' | 'favorites';

// ---------------------------------------------------------------------------
// Skeleton — pulses exactly like SkeletonCard but with custom shape
// ---------------------------------------------------------------------------

function usePulse() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);
  return opacity;
}

function ProfileSkeleton() {
  const opacity = usePulse();
  const box = (w: number | string, h: number, r = 8) => (
    <Animated.View style={{ width: w as number, height: h, borderRadius: r, backgroundColor: theme.BORDER, opacity }} />
  );
  return (
    <View style={sk.root}>
      <View style={sk.header}>
        <Animated.View style={[sk.avatarCircle, { opacity }]} />
        <View style={sk.headerText}>
          {box('60%', 18, 6)}
          {box('40%', 14, 6)}
        </View>
      </View>
      <View style={sk.stats}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={sk.statCol}>
            {box(40, 20, 6)}
            {box(50, 12, 4)}
          </View>
        ))}
      </View>
    </View>
  );
}

const sk = StyleSheet.create({
  root: { padding: 20, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.BORDER },
  headerText: { flex: 1, gap: 8 },
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  statCol: { alignItems: 'center', gap: 6 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<ReviewCardData[]>([]);
  const [favorites, setFavorites] = useState<EateryCardData[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('reviews');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingTab, setLoadingTab] = useState(false);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Edit sheet state
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['55%', '90%'], []);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCity, setEditCity] = useState<City | null>(null);
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────

  useEffect(() => { loadProfile(); }, []);

  useEffect(() => {
    if (activeTab === 'reviews' && !reviewsLoaded) loadReviews();
    if (activeTab === 'favorites' && !favoritesLoaded) loadFavorites();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up realtime channel on unmount
  useEffect(() => () => { notifChannelRef.current?.unsubscribe(); }, []);

  async function loadProfile() {
    setLoadingProfile(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/splash'); return; }

      // Load unread notification count + subscribe to new notifications
      loadUnreadCount(user.id);

      const [profileRes, friendsRes, reviewsRes] = await Promise.all([
        withRetry(() => supabase.from('users').select('*').eq('id', user.id).single()),
        withRetry(() =>
          supabase.from('friendships').select('*', { count: 'exact', head: true })
            .eq('status', 'accepted')
            .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
        ),
        withRetry(() => supabase.from('reviews').select('rank').eq('user_id', user.id)),
      ]);

      if (profileRes.error) throw profileRes.error;
      setProfile(profileRes.data as UserProfile);

      const rankData = (reviewsRes.data ?? []) as { rank: number }[];
      const reviewCount = rankData.length;
      const avgRank = reviewCount
        ? rankData.reduce((s, r) => s + r.rank, 0) / reviewCount
        : 0;

      setStats({
        friendsCount: friendsRes.count ?? 0,
        reviewsCount: reviewCount,
        avgRank,
      });
    } catch (e) {
      logger.error('Failed to load profile', e);
      Toast.show({ type: 'error', text1: 'Failed to load profile' });
    } finally {
      setLoadingProfile(false);
    }
  }

  async function loadUnreadCount(userId: string) {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);
    setUnreadCount(count ?? 0);

    // Subscribe to new notifications to bump the badge in real-time
    notifChannelRef.current?.unsubscribe();
    notifChannelRef.current = supabase
      .channel(`profile-notifs:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => setUnreadCount((c) => c + 1),
      )
      .subscribe();
  }

  async function loadReviews() {
    if (!profile) return;
    setLoadingTab(true);
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('reviews')
          .select('id, rank, text, favourite_dish, eatery:eateries(id, name, photos)')
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false }),
      );
      if (error) throw error;
      setReviews((data ?? []) as unknown as ReviewCardData[]);
      setReviewsLoaded(true);
    } catch (e) {
      logger.error('Failed to load reviews', e);
    } finally {
      setLoadingTab(false);
    }
  }

  async function loadFavorites() {
    if (!profile) return;
    setLoadingTab(true);
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('reviews')
          .select('eatery:eateries(id, name, photos)')
          .eq('user_id', profile.id)
          .gte('rank', 4)
          .order('rank', { ascending: false }),
      );
      if (error) throw error;
      const eateries = ((data ?? []) as unknown as { eatery: EateryCardData }[])
        .map((r) => r.eatery)
        .filter(Boolean);
      setFavorites(eateries);
      setFavoritesLoaded(true);
    } catch (e) {
      logger.error('Failed to load favorites', e);
    } finally {
      setLoadingTab(false);
    }
  }

  // ── Edit sheet ────────────────────────────────────────────────────────────

  function openEditSheet() {
    if (!profile) return;
    setEditName(profile.name);
    setEditBio(profile.bio ?? '');
    setEditCity(profile.city);
    setEditPhotoUri(null);
    setEditPhotoUrl(profile.photo_url);
    setUploadProgress(0);
    sheetRef.current?.expand();
  }

  async function pickEditPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Toast.show({ type: 'error', text1: 'Photo library access required' }); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !profile) return;
    const asset = result.assets[0];
    setEditPhotoUri(asset.uri);
    setUploading(true);
    try {
      const url = await uploadAvatar(asset.uri, profile.id, (p) => { setUploadProgress(p); });
      setEditPhotoUrl(url);
    } catch (err) {
      logger.error('Avatar upload failed', err);
      Toast.show({ type: 'error', text1: (err as Error).message });
      setEditPhotoUri(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!profile) return;

    const nameParsed = nameSchema.safeParse(editName);
    if (!nameParsed.success) { Toast.show({ type: 'error', text1: nameParsed.error.issues[0].message }); return; }

    const bioParsed = bioSchema.safeParse(editBio || undefined);
    if (!bioParsed.success) { Toast.show({ type: 'error', text1: bioParsed.error.issues[0].message }); return; }

    const updates = {
      name: nameParsed.data,
      bio: bioParsed.data ?? null,
      city: editCity,
      photo_url: editPhotoUrl,
    };

    // Optimistic update
    const previous = profile;
    setProfile((p) => p ? { ...p, ...updates } : p);
    sheetRef.current?.close();

    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', profile.id);
      if (error) throw error;
    } catch (e) {
      logger.error('Profile update failed', e);
      setProfile(previous); // revert
      Toast.show({ type: 'error', text1: 'Failed to save changes' });
      sheetRef.current?.expand();
    } finally {
      setSaving(false);
    }
  }

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="close" />
    ),
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingProfile || !profile || !stats) {
    return (
      <SafeAreaView style={s.root}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  const avgRankDisplay = stats.avgRank > 0 ? `#${stats.avgRank.toFixed(1)}` : '--';

  return (
    <View style={s.root}>
      <SafeAreaView style={{ backgroundColor: theme.BG }}>
        {/* ── Top bar: notifications + settings ───────────────────────── */}
        <View style={s.topBar}>
          <Pressable
            style={s.bellBtn}
            onPress={() => { setUnreadCount(0); router.push('/notifications'); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Ionicons name="notifications-outline" size={24} color={theme.TEXT} />
            {unreadCount > 0 && (
              <View style={s.bellBadge}>
                <Text style={s.bellBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={s.bellBtn}
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={24} color={theme.TEXT} />
          </Pressable>
        </View>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={s.header}>
          <Avatar uri={profile.photo_url} name={profile.name} size={80} />
          <View style={s.headerText}>
            <Text style={s.name}>{profile.name}</Text>
            <Text style={s.username}>@{profile.username}</Text>
            {profile.bio ? <Text style={s.bio} numberOfLines={2}>{profile.bio}</Text> : null}
            <CityBadge city={profile.city} size="md" />
          </View>
        </View>

        {/* ── Stats ──────────────────────────────────────────────────── */}
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

        {/* ── Edit button ─────────────────────────────────────────────── */}
        <Pressable style={s.editBtn} onPress={openEditSheet}>
          {saving
            ? <ActivityIndicator color={theme.PRIMARY} size="small" />
            : <Text style={s.editBtnText}>Edit Profile</Text>}
        </Pressable>

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <View style={s.tabBar}>
          {(['reviews', 'favorites'] as const).map((tab) => (
            <Pressable key={tab} style={s.tabItem} onPress={() => setActiveTab(tab)}>
              <Text style={[s.tabLabel, activeTab === tab && s.tabLabelActive]}>
                {tab === 'reviews' ? 'Reviews' : 'Favorites'}
              </Text>
              {activeTab === tab && <View style={s.tabUnderline} />}
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      {/* ── Tab content ──────────────────────────────────────────────── */}
      {loadingTab ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={theme.PRIMARY} />
      ) : activeTab === 'reviews' ? (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => (
            <ReviewCard review={item} onPress={() => router.push(`/eatery/${item.eatery.id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No reviews yet" subtitle="Go find somewhere to eat!" />
          }
        />
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(e) => e.id}
          numColumns={2}
          contentContainerStyle={s.listContent}
          columnWrapperStyle={s.columnWrapper}
          renderItem={({ item }) => (
            <EateryPhotoCard eatery={item} onPress={() => router.push(`/eatery/${item.id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No favorites yet" subtitle="Rate places 4+ to save them here." />
          }
        />
      )}

      {/* ── Edit profile bottom sheet ────────────────────────────────── */}
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={{ backgroundColor: theme.BORDER }}
        backgroundStyle={{ backgroundColor: theme.BG }}
      >
        <BottomSheetScrollView contentContainerStyle={s.sheet} keyboardShouldPersistTaps="handled">
          <Text style={s.sheetTitle}>Edit Profile</Text>

          {/* Avatar picker */}
          <Pressable style={s.sheetAvatar} onPress={pickEditPhoto} disabled={uploading}>
            <Avatar
              uri={editPhotoUri ?? editPhotoUrl}
              name={editName || profile.name}
              size={80}
            />
            <View style={s.cameraBadge}>
              {uploading
                ? <ActivityIndicator size="small" color={theme.BG} />
                : <Ionicons name="camera" size={14} color={theme.BG} />}
            </View>
          </Pressable>

          <Text style={s.fieldLabel}>Name</Text>
          <BottomSheetTextInput
            style={s.sheetInput}
            value={editName}
            onChangeText={setEditName}
            placeholder="Your full name"
            placeholderTextColor={theme.MUTED}
          />

          <View style={s.fieldLabelRow}>
            <Text style={s.fieldLabel}>Bio</Text>
            <Text style={s.charCounter}>{editBio.length}/160</Text>
          </View>
          <BottomSheetTextInput
            style={[s.sheetInput, s.sheetTextarea]}
            value={editBio}
            onChangeText={(t) => setEditBio(t.slice(0, 160))}
            placeholder="Tell people about yourself"
            placeholderTextColor={theme.MUTED}
            multiline
            textAlignVertical="top"
          />

          <Text style={s.fieldLabel}>City</Text>
          <View style={s.cityRow}>
            {(['riyadh', 'dubai'] as City[]).map((c) => (
              <Pressable
                key={c}
                style={[s.cityChip, editCity === c && s.cityChipActive]}
                onPress={() => setEditCity(c)}
              >
                <Text style={[s.cityChipText, editCity === c && s.cityChipTextActive]}>
                  {c === 'riyadh' ? 'Riyadh' : 'Dubai'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[s.saveBtn, (saving || uploading) && s.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || uploading}
          >
            {saving
              ? <ActivityIndicator color={theme.BG} />
              : <Text style={s.saveBtnText}>Save changes</Text>}
          </Pressable>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },

  // Top bar with bell
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 16, paddingTop: 8 },
  bellBtn: { padding: 6, position: 'relative' },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.ERROR,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  // Header
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  headerText: { flex: 1, gap: 4 },
  name: { fontSize: 18, fontWeight: '700', color: theme.TEXT },
  username: { fontSize: 14, color: theme.MUTED },
  bio: { fontSize: 13, color: theme.TEXT, lineHeight: 18 },

  // Stats
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.BORDER },
  statCol: { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', color: theme.TEXT },
  statLabel: { fontSize: 11, color: theme.MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Edit button
  editBtn: {
    marginHorizontal: 20,
    marginVertical: 14,
    height: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { color: theme.PRIMARY, fontSize: 15, fontWeight: '700' },

  // Tab bar
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.BORDER },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 14, fontWeight: '500', color: theme.MUTED },
  tabLabelActive: { fontWeight: '700', color: theme.PRIMARY },
  tabUnderline: { position: 'absolute', bottom: 0, height: 2, width: '60%', backgroundColor: theme.PRIMARY, borderRadius: 1 },

  // List content
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  columnWrapper: { gap: 12 },

  // Bottom sheet
  sheet: { padding: 24, paddingBottom: 40, gap: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: theme.TEXT, marginBottom: 8 },
  sheetAvatar: { alignSelf: 'center', marginBottom: 8 },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.BG,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: theme.TEXT, marginTop: 4 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  charCounter: { fontSize: 12, color: theme.MUTED },
  sheetInput: {
    height: 48,
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
  },
  sheetTextarea: { height: 100, paddingTop: 12 },
  cityRow: { flexDirection: 'row', gap: 10 },
  cityChip: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.SURFACE,
  },
  cityChipActive: { borderColor: theme.PRIMARY, backgroundColor: theme.PRIMARY_LIGHT },
  cityChipText: { fontSize: 14, fontWeight: '600', color: theme.MUTED },
  cityChipTextActive: { color: theme.PRIMARY },
  saveBtn: {
    height: 52,
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: theme.BG, fontSize: 16, fontWeight: '700' },
});

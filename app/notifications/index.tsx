import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { relativeTime } from '../../lib/format';
import { Avatar } from '../../components/Avatar';
import { SkeletonCard } from '../../components/SkeletonCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotifType = 'friend_request' | 'friend_accepted' | 'friend_reviewed_eatery';

interface NotifRow {
  id: string;
  type: NotifType;
  actor_id: string | null;
  entity_id: string | null;
  read: boolean;
  created_at: string;
  actor: { id: string; name: string; username: string; photo_url: string | null } | null;
  eateryName: string | null; // resolved separately for friend_reviewed_eatery
}

interface Section {
  title: string;
  data: NotifRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByDate(rows: NotifRow[]): Section[] {
  const now = Date.now();
  const DAY_MS = 86_400_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const weekMs = todayMs - 6 * DAY_MS;

  const groups: Record<string, NotifRow[]> = { Today: [], 'This week': [], Earlier: [] };

  for (const n of rows) {
    const t = new Date(n.created_at).getTime();
    if (t >= todayMs) groups['Today'].push(n);
    else if (t >= weekMs) groups['This week'].push(n);
    else groups['Earlier'].push(n);
  }

  return Object.entries(groups)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

function notifMessage(n: NotifRow): string {
  const name = n.actor?.name ?? 'Someone';
  switch (n.type) {
    case 'friend_request':
      return `${name} sent you a friend request`;
    case 'friend_accepted':
      return `${name} accepted your friend request`;
    case 'friend_reviewed_eatery':
      return `${name} reviewed ${n.eateryName ?? 'a restaurant'}`;
  }
}

// ---------------------------------------------------------------------------
// SwipeDelete wrapper
// ---------------------------------------------------------------------------

function SwipeToDelete({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  function renderRight(progress: Animated.AnimatedInterpolation<number>) {
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [80, 0],
    });
    return (
      <Animated.View style={[sd.action, { transform: [{ translateX }] }]}>
        <Pressable style={sd.btn} onPress={onDelete}>
          <Ionicons name="trash-outline" size={22} color="#fff" />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Swipeable
      renderRightActions={renderRight}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

const sd = StyleSheet.create({
  action: { width: 80, justifyContent: 'center' },
  btn: {
    flex: 1,
    backgroundColor: theme.ERROR,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ---------------------------------------------------------------------------
// NotifRow component
// ---------------------------------------------------------------------------

function NotifItem({
  item,
  onDismiss,
  onAccept,
  onDecline,
}: {
  item: NotifRow;
  onDismiss: () => void;
  onAccept: (actorId: string) => void;
  onDecline: (actorId: string) => void;
}) {
  function handlePress() {
    if (item.type === 'friend_reviewed_eatery' && item.entity_id) {
      router.push(`/eatery/${item.entity_id}`);
    } else if (item.type === 'friend_request' && item.actor_id) {
      router.push(`/friends/${item.actor_id}`);
    } else if (item.type === 'friend_accepted' && item.actor_id) {
      router.push(`/friends/${item.actor_id}`);
    }
  }

  return (
    <SwipeToDelete onDelete={onDismiss}>
      <Pressable
        style={[ni.row, !item.read && ni.rowUnread]}
        onPress={handlePress}
      >
        {/* Unread dot */}
        {!item.read && <View style={ni.dot} />}

        {/* Actor avatar */}
        <Pressable
          onPress={() => item.actor_id && router.push(`/friends/${item.actor_id}`)}
        >
          <Avatar
            uri={item.actor?.photo_url ?? null}
            name={item.actor?.name ?? '?'}
            size={44}
          />
        </Pressable>

        {/* Text content */}
        <View style={ni.body}>
          <Text style={ni.message} numberOfLines={2}>
            {notifMessage(item)}
          </Text>
          <Text style={ni.time}>{relativeTime(item.created_at)}</Text>

          {/* Inline accept / decline for friend_request */}
          {item.type === 'friend_request' && item.actor_id && (
            <View style={ni.btnRow}>
              <Pressable
                style={ni.acceptBtn}
                onPress={() => onAccept(item.actor_id!)}
              >
                <Text style={ni.acceptText}>Accept</Text>
              </Pressable>
              <Pressable
                style={ni.declineBtn}
                onPress={() => onDecline(item.actor_id!)}
              >
                <Text style={ni.declineText}>Decline</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Pressable>
    </SwipeToDelete>
  );
}

const ni = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: theme.BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.BORDER,
  },
  rowUnread: { backgroundColor: theme.PRIMARY_LIGHT },
  dot: {
    position: 'absolute',
    top: 20,
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.PRIMARY,
  },
  body: { flex: 1, gap: 4 },
  message: { fontSize: 14, color: theme.TEXT, lineHeight: 20 },
  time: { fontSize: 12, color: theme.MUTED },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  acceptBtn: {
    flex: 1,
    height: 34,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  declineBtn: {
    flex: 1,
    height: 34,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { fontSize: 13, fontWeight: '600', color: theme.MUTED },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const myIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    load();
    return () => { channelRef.current?.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      myIdRef.current = user.id;

      const rows = await fetchNotifications(user.id);
      setNotifications(rows);
      markAllRead(user.id);
      subscribeRealtime(user.id);
    } catch (e) {
      logger.error('Failed to load notifications', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchNotifications(userId: string): Promise<NotifRow[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*, actor:users!actor_id(id, name, username, photo_url)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;

    const rows = (data ?? []) as unknown as (NotifRow & {
      actor: NotifRow['actor'];
    })[];

    // Batch-fetch eatery names for friend_reviewed_eatery notifications
    const eateryIds = [
      ...new Set(
        rows
          .filter((r) => r.type === 'friend_reviewed_eatery' && r.entity_id)
          .map((r) => r.entity_id!),
      ),
    ];

    const eateryMap: Record<string, string> = {};
    if (eateryIds.length > 0) {
      const { data: eateries } = await supabase
        .from('eateries')
        .select('id, name')
        .in('id', eateryIds);
      for (const e of eateries ?? []) {
        eateryMap[e.id] = e.name;
      }
    }

    return rows.map((r) => ({
      ...r,
      eateryName: r.entity_id ? (eateryMap[r.entity_id] ?? null) : null,
    }));
  }

  async function markAllRead(userId: string) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
  }

  function subscribeRealtime(userId: string) {
    channelRef.current = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const raw = payload.new as NotifRow;
          // Fetch actor + eatery for the incoming row
          let actor: NotifRow['actor'] = null;
          if (raw.actor_id) {
            const { data } = await supabase
              .from('users')
              .select('id, name, username, photo_url')
              .eq('id', raw.actor_id)
              .single();
            actor = data ?? null;
          }
          let eateryName: string | null = null;
          if (raw.type === 'friend_reviewed_eatery' && raw.entity_id) {
            const { data } = await supabase
              .from('eateries')
              .select('name')
              .eq('id', raw.entity_id)
              .single();
            eateryName = data?.name ?? null;
          }
          setNotifications((prev) => [{ ...raw, actor, eateryName }, ...prev]);
        },
      )
      .subscribe();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function dismiss(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  }

  async function markAllReadNow() {
    if (!myIdRef.current) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllRead(myIdRef.current);
    Toast.show({ type: 'success', text1: 'All caught up!' });
  }

  async function acceptRequest(actorId: string) {
    try {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('requester_id', actorId)
        .eq('addressee_id', myIdRef.current!);
      if (error) throw error;
      // Remove the friend_request notification, will be replaced by friend_accepted via realtime
      setNotifications((prev) =>
        prev.filter((n) => !(n.type === 'friend_request' && n.actor_id === actorId)),
      );
      Toast.show({ type: 'success', text1: 'Friend request accepted!' });
    } catch (e) {
      logger.error('Accept friend request failed', e);
      Toast.show({ type: 'error', text1: 'Could not accept request' });
    }
  }

  async function declineRequest(actorId: string) {
    try {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'declined' })
        .eq('requester_id', actorId)
        .eq('addressee_id', myIdRef.current!);
      if (error) throw error;
      setNotifications((prev) =>
        prev.filter((n) => !(n.type === 'friend_request' && n.actor_id === actorId)),
      );
    } catch (e) {
      logger.error('Decline friend request failed', e);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const sections = useMemo(() => groupByDate(notifications), [notifications]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const renderItem = useCallback(
    ({ item }: { item: NotifRow }) => (
      <NotifItem
        item={item}
        onDismiss={() => dismiss(item.id)}
        onAccept={acceptRequest}
        onDecline={declineRequest}
      />
    ),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>{section.title}</Text>
      </View>
    ),
    [],
  );

  if (loading) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
          </Pressable>
          <Text style={s.title}>Notifications</Text>
          <View style={{ width: 30 }} />
        </View>
        <View style={{ padding: 20, gap: 10 }}>
          {[70, 70, 90, 70].map((h, i) => <SkeletonCard key={i} height={h} />)}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
        </Pressable>
        <Text style={s.title}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllReadNow} hitSlop={8}>
            <Text style={s.markAllText}>Mark all read</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="notifications-outline" size={44} color={theme.BORDER} />
            <Text style={s.emptyTitle}>You're all caught up</Text>
            <Text style={s.emptySub}>Friend activity will appear here.</Text>
          </View>
        }
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.BORDER,
  },
  title: { fontSize: 17, fontWeight: '700', color: theme.TEXT },
  markAllText: { fontSize: 13, color: theme.PRIMARY, fontWeight: '600' },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    backgroundColor: theme.BG,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.TEXT },
  emptySub: { fontSize: 14, color: theme.MUTED, textAlign: 'center' },
});

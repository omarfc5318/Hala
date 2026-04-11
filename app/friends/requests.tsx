import { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { withRetry } from '../../lib/retry';
import { Avatar } from '../../components/Avatar';
import { SkeletonCard } from '../../components/SkeletonCard';
import { EmptyState } from '../../components/EmptyState';
import type { City } from '../../lib/validation';

interface RequestRow {
  id: string;              // friendship row id
  requester_id: string;
  sender: {
    id: string;
    name: string;
    username: string;
    photo_url: string | null;
    city: City | null;
  };
  mutualCount: number;
}

async function getMutualCount(myId: string, theirId: string): Promise<number> {
  try {
    const [mine, theirs] = await Promise.all([
      supabase.from('friendships').select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`),
      supabase.from('friendships').select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${theirId},addressee_id.eq.${theirId}`),
    ]);
    const mySet = new Set(
      (mine.data ?? []).map((f) => (f.requester_id === myId ? f.addressee_id : f.requester_id)),
    );
    return (theirs.data ?? []).filter((f) => {
      const id = f.requester_id === theirId ? f.addressee_id : f.requester_id;
      return mySet.has(id);
    }).length;
  } catch {
    return 0;
  }
}

export default function FriendRequestsScreen() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    loadRequests();
  }, []);

  // Subscribe to real-time INSERT events so new requests pop in without refresh
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      currentUserIdRef.current = user.id;

      channel = supabase
        .channel(`friend-requests-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'friendships',
            filter: `addressee_id=eq.${user.id}`,
          },
          () => { loadRequests(); },   // refetch the full list on any new insert
        )
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRequests() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await withRetry(() =>
        supabase
          .from('friendships')
          .select('id, requester_id, sender:users!requester_id(id, name, username, photo_url, city)')
          .eq('addressee_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      );
      if (error) throw error;

      // Compute mutual friends in parallel (list is short — usually < 20)
      const rows = data ?? [];
      const withMutuals = await Promise.all(
        rows.map(async (r: any) => ({
          id: r.id,
          requester_id: r.requester_id,
          sender: r.sender,
          mutualCount: await getMutualCount(user.id, r.requester_id),
        })),
      );

      setRequests(withMutuals as RequestRow[]);
    } catch (e) {
      logger.error('Failed to load friend requests', e);
    } finally {
      setLoading(false);
    }
  }

  async function respond(requestId: string, fromUserId: string, accept: boolean) {
    const myId = currentUserIdRef.current;
    if (!myId) return;

    // Optimistic removal from list
    setRequests((r) => r.filter((req) => req.id !== requestId));

    try {
      await supabase
        .from('friendships')
        .update({ status: accept ? 'accepted' : 'declined' })
        .eq('id', requestId);

      if (accept) {
        // Insert the reverse friendship row so both sides can query symmetrically
        await supabase.from('friendships').insert({
          requester_id: myId,
          addressee_id: fromUserId,
          status: 'accepted',
        });
      }
      Toast.show({ type: 'success', text1: accept ? 'Friend added!' : 'Request declined' });
    } catch (e) {
      logger.error('Respond to friend request failed', e);
      Toast.show({ type: 'error', text1: 'Action failed — please try again' });
      loadRequests(); // revert by refetching
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <Text style={s.heading}>Friend Requests</Text>

      {loading ? (
        <View style={s.pad}>{[1, 2, 3].map((i) => <SkeletonCard key={i} height={72} />)}</View>
      ) : requests.length === 0 ? (
        <EmptyState title="No pending requests" subtitle="You're all caught up!" />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.pad}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Avatar uri={item.sender.photo_url} name={item.sender.name} size={48} />
              <View style={s.rowText}>
                <Text style={s.name}>{item.sender.name}</Text>
                <Text style={s.username}>@{item.sender.username}</Text>
                {item.mutualCount > 0 && (
                  <Text style={s.mutual}>
                    {item.mutualCount} mutual friend{item.mutualCount > 1 ? 's' : ''}
                  </Text>
                )}
              </View>
              <View style={s.actions}>
                <Pressable
                  style={s.acceptBtn}
                  onPress={() => respond(item.id, item.requester_id, true)}
                >
                  <Text style={s.acceptText}>Accept</Text>
                </Pressable>
                <Pressable
                  style={s.declineBtn}
                  onPress={() => respond(item.id, item.requester_id, false)}
                >
                  <Text style={s.declineText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  heading: { fontSize: 22, fontWeight: '800', color: theme.TEXT, paddingHorizontal: 16, paddingVertical: 14 },
  pad: { padding: 16, gap: 10, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: theme.SURFACE,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700', color: theme.TEXT },
  username: { fontSize: 12, color: theme.MUTED },
  mutual: { fontSize: 11, color: theme.PRIMARY, fontWeight: '500', marginTop: 2 },
  actions: { flexDirection: 'column', gap: 6 },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: theme.SUCCESS,
    borderRadius: 999,
    alignItems: 'center',
  },
  acceptText: { fontSize: 13, fontWeight: '700', color: theme.BG },
  declineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.ERROR,
    alignItems: 'center',
  },
  declineText: { fontSize: 13, fontWeight: '600', color: theme.ERROR },
});

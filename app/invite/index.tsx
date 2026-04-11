// app/invite/index.tsx
// Requires: npx expo install expo-clipboard
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Share,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { SkeletonCard } from '../../components/SkeletonCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InviteCode {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  claimedUsername: string | null;
}

const MAX_CODES = 5;
const INVITE_BASE_URL = 'https://hala.app/join';
const WHATSAPP_MESSAGE = (url: string) =>
  `Hey! I'd love for you to join me on Hala — the best way to discover restaurants through people you trust. Use my invite link: ${url}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpiry(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// InviteRow
// ---------------------------------------------------------------------------

function InviteRow({ item }: { item: InviteCode }) {
  const url = `${INVITE_BASE_URL}/${item.code}`;
  const used = item.used_at !== null;
  const expired = !used && new Date(item.expires_at) < new Date();

  async function copyLink() {
    await Clipboard.setStringAsync(url);
    Toast.show({ type: 'success', text1: 'Link copied!' });
  }

  function shareWhatsApp() {
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(WHATSAPP_MESSAGE(url))}`).catch(() =>
      Toast.show({ type: 'error', text1: 'WhatsApp not installed' }),
    );
  }

  return (
    <View style={[ir.card, (used || expired) && ir.cardDim]}>
      <View style={ir.top}>
        {/* Code + status */}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[ir.code, (used || expired) && ir.codeDim]} selectable>
            {item.code}
          </Text>
          {used && item.claimedUsername ? (
            <Text style={ir.meta}>
              <Ionicons name="checkmark-circle" size={12} color={theme.SUCCESS} />
              {' '}Claimed by @{item.claimedUsername}
            </Text>
          ) : expired ? (
            <Text style={[ir.meta, { color: theme.ERROR }]}>Expired</Text>
          ) : (
            <Text style={ir.meta}>Expires {formatExpiry(item.expires_at)}</Text>
          )}
        </View>

        {/* Actions — hidden for used/expired codes */}
        {!used && !expired && (
          <View style={ir.actions}>
            <Pressable style={ir.iconBtn} onPress={copyLink} hitSlop={8}>
              <Ionicons name="copy-outline" size={18} color={theme.PRIMARY} />
            </Pressable>
            <Pressable style={ir.iconBtn} onPress={shareWhatsApp} hitSlop={8}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Full URL */}
      {!used && !expired && (
        <Text style={ir.url} numberOfLines={1}>
          {url}
        </Text>
      )}
    </View>
  );
}

const ir = StyleSheet.create({
  card: {
    backgroundColor: theme.SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  cardDim: { opacity: 0.55 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  code: { fontSize: 15, fontWeight: '700', color: theme.TEXT, fontVariant: ['tabular-nums'] },
  codeDim: { color: theme.MUTED },
  meta: { fontSize: 12, color: theme.MUTED },
  url: { fontSize: 11, color: theme.MUTED },
  actions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.BG,
    borderWidth: 1,
    borderColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function InviteScreen() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadCodes();
  }, []);

  async function loadCodes() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch my invite codes + claimed-by username in one query
      const { data, error } = await supabase
        .from('invitations')
        .select('id, code, created_at, expires_at, used_at, used_by, users!used_by(username)')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows: InviteCode[] = ((data ?? []) as unknown as {
        id: string;
        code: string;
        created_at: string;
        expires_at: string;
        used_at: string | null;
        used_by: string | null;
        users: { username: string } | null;
      }[]).map((r) => ({
        ...r,
        claimedUsername: r.users?.username ?? null,
      }));

      setCodes(rows);
    } catch (e) {
      logger.error('Failed to load invite codes', e);
      Toast.show({ type: 'error', text1: 'Could not load invite codes' });
    } finally {
      setLoading(false);
    }
  }

  async function generateCode() {
    setGenerating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('invitations')
        .insert({ created_by: user.id });

      if (error) throw error;
      await loadCodes();
      Toast.show({ type: 'success', text1: 'Invite code created!' });
    } catch (e) {
      logger.error('Failed to generate invite code', e);
      Toast.show({ type: 'error', text1: 'Could not generate code' });
    } finally {
      setGenerating(false);
    }
  }

  async function shareAppLink() {
    try {
      await Share.share({
        message: `Join me on Hala — restaurant reviews from people you trust.\n\nhttps://hala.app`,
        url: 'https://hala.app',
      });
    } catch (e) {
      logger.error('Share failed', e);
    }
  }

  const activeCount = codes.filter((c) => !c.used_at && new Date(c.expires_at) >= new Date()).length;
  const canGenerate = activeCount < MAX_CODES;

  if (loading) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
          </Pressable>
          <Text style={s.title}>Invites</Text>
          <View style={{ width: 30 }} />
        </View>
        <View style={{ padding: 20, gap: 12 }}>
          {[80, 80, 80].map((h, i) => <SkeletonCard key={i} height={h} />)}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
        </Pressable>
        <Text style={s.title}>Invites</Text>
        <View style={{ width: 30 }} />
      </View>

      <FlatList
        data={codes}
        keyExtractor={(c) => c.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Invite count banner */}
            <View style={s.banner}>
              <Ionicons name="people-outline" size={20} color={theme.PRIMARY} />
              <Text style={s.bannerText}>
                {activeCount} of {MAX_CODES} invites available
              </Text>
            </View>

            {/* Generate button */}
            <Pressable
              style={[s.generateBtn, !canGenerate && s.generateBtnDisabled]}
              disabled={!canGenerate || generating}
              onPress={generateCode}
            >
              {generating
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="add-circle-outline" size={18} color="#fff" />
                    <Text style={s.generateBtnText}>Generate invite</Text>
                  </>
              }
            </Pressable>
            {!canGenerate && (
              <Text style={s.limitNote}>
                You've reached the maximum of {MAX_CODES} invite codes.
              </Text>
            )}

            {codes.length > 0 && <Text style={s.sectionLabel}>Your codes</Text>}
          </>
        }
        renderItem={({ item }) => <InviteRow item={item} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="mail-outline" size={40} color={theme.BORDER} />
            <Text style={s.emptyText}>No invite codes yet</Text>
            <Text style={s.emptySubtext}>Generate one above to invite a friend.</Text>
          </View>
        }
        ListFooterComponent={
          <Pressable style={s.shareAppBtn} onPress={shareAppLink}>
            <Ionicons name="share-outline" size={18} color={theme.PRIMARY} />
            <Text style={s.shareAppText}>Share Hala with a friend</Text>
          </Pressable>
        }
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
  },
  title: { fontSize: 17, fontWeight: '700', color: theme.TEXT },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.PRIMARY_LIGHT,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { fontSize: 14, fontWeight: '600', color: theme.PRIMARY_DARK },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    marginBottom: 8,
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  limitNote: { fontSize: 12, color: theme.MUTED, textAlign: 'center', marginBottom: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '700', color: theme.TEXT },
  emptySubtext: { fontSize: 14, color: theme.MUTED, textAlign: 'center' },
  shareAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
  },
  shareAppText: { fontSize: 14, fontWeight: '600', color: theme.PRIMARY },
});

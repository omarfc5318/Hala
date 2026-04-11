import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Phase =
  | 'checking'        // reading SecureStore + auth session
  | 'has_invite'      // valid invite found in store
  | 'no_invite'       // no invite, show waitlist screen
  | 'entering_code'   // user typing a code manually
  | 'validating'      // calling validate-invite
  | 'code_valid';     // just validated, ready to sign up

const SECURE_STORE_KEY = 'invite_code';
const WAITLIST_URL = 'https://hala.app/waitlist';

function edgeFunctionUrl(path: string): string {
  const base = (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ?? '';
  return `${base}/functions/v1/${path}`;
}

async function validateInviteCode(code: string): Promise<{ valid: boolean; created_by_username?: string }> {
  const res = await fetch(edgeFunctionUrl('validate-invite'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { valid: false };
  return res.json();
}

// ---------------------------------------------------------------------------
// Sub-screens
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <View style={s.hero}>
      <Text style={s.wordmark}>هلا Hala</Text>
      <Text style={s.tagline}>Restaurant reviews from people you trust</Text>
    </View>
  );
}

// Waitlist screen — shown when no invite is present
function NoInviteScreen({ onEnterCode }: { onEnterCode: () => void }) {
  return (
    <SafeAreaView style={s.root}>
      <StatusBar hidden />
      <Hero />
      <View style={s.ctas}>
        <View style={s.lockBox}>
          <Ionicons name="lock-closed" size={22} color={theme.MUTED} />
          <Text style={s.lockText}>Hala is invite-only for now</Text>
        </View>

        <Pressable
          style={[s.btn, s.btnFilled]}
          onPress={() => Linking.openURL(WAITLIST_URL)}
        >
          <Text style={s.btnFilledText}>Join the waitlist</Text>
        </Pressable>

        <Pressable style={s.textLink} onPress={onEnterCode}>
          <Text style={s.textLinkText}>Already have a code?</Text>
          <Text style={[s.textLinkText, { color: theme.PRIMARY, fontWeight: '700' }]}>
            {' '}Enter invite code
          </Text>
        </Pressable>

        <Pressable
          style={[s.btn, s.btnOutline, { marginTop: 4 }]}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={s.btnOutlineText}>Sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// Code-entry screen
function EnterCodeScreen({
  onValidated,
  onBack,
}: {
  onValidated: (code: string, username: string | null) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setValidating(true);
    setError(null);
    try {
      const result = await validateInviteCode(trimmed);
      if (result.valid) {
        await SecureStore.setItemAsync(SECURE_STORE_KEY, trimmed);
        onValidated(trimmed, result.created_by_username ?? null);
      } else {
        setError('This code is invalid, expired, or already used.');
      }
    } catch (e) {
      logger.error('Code validation failed', e);
      setError('Could not verify the code. Check your connection.');
    } finally {
      setValidating(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar hidden />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backRow} onPress={onBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        <View style={s.hero}>
          <Text style={s.wordmark}>هلا Hala</Text>
          <Text style={s.tagline}>Enter your invite code to get started</Text>
        </View>

        <View style={s.ctas}>
          <TextInput
            style={[s.codeInput, error ? s.codeInputError : null]}
            value={code}
            onChangeText={(t) => { setCode(t); setError(null); }}
            placeholder="e.g. a1b2c3d4e5f6"
            placeholderTextColor={theme.MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={verify}
          />
          {error && <Text style={s.errorText}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnFilled, (!code.trim() || validating) && s.pressed]}
            disabled={!code.trim() || validating}
            onPress={verify}
          >
            {validating
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnFilledText}>Verify code</Text>
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Has-invite screen
function HasInviteScreen({
  invitedBy,
  onContinue,
}: {
  invitedBy: string | null;
  onContinue: () => void;
}) {
  return (
    <SafeAreaView style={s.root}>
      <StatusBar hidden />
      <Hero />
      <View style={s.ctas}>
        <View style={s.invitedBadge}>
          <Ionicons name="checkmark-circle" size={20} color={theme.SUCCESS} />
          <Text style={s.invitedText}>
            {invitedBy ? `Invited by @${invitedBy}` : 'Invite accepted'}
          </Text>
        </View>

        <Pressable
          style={[s.btn, s.btnFilled]}
          onPress={onContinue}
        >
          <Text style={s.btnFilledText}>Create account</Text>
        </Pressable>

        <Pressable
          style={[s.btn, s.btnOutline]}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={s.btnOutlineText}>Sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const inviteCodeRef = useRef<string | null>(null);

  useEffect(() => {
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    try {
      // 1. Check existing session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/(tabs)/search');
        return;
      }

      // 2. Check SecureStore for saved invite code
      const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY);
      if (stored) {
        const result = await validateInviteCode(stored);
        if (result.valid) {
          inviteCodeRef.current = stored;
          setInvitedBy(result.created_by_username ?? null);
          setPhase('has_invite');
          return;
        }
        // Stale/used code — clear it
        await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
      }

      setPhase('no_invite');
    } catch (e) {
      logger.error('Splash init failed', e);
      setPhase('no_invite');
    }
  }

  function onCodeValidated(code: string, username: string | null) {
    inviteCodeRef.current = code;
    setInvitedBy(username);
    setPhase('has_invite');
  }

  function navigateToSignup() {
    router.push('/(auth)/signup');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'checking') {
    return (
      <View style={s.loadingRoot}>
        <Text style={s.wordmark}>هلا Hala</Text>
        <ActivityIndicator color={theme.PRIMARY} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (phase === 'no_invite') {
    return (
      <NoInviteScreen onEnterCode={() => setPhase('entering_code')} />
    );
  }

  if (phase === 'entering_code') {
    return (
      <EnterCodeScreen
        onValidated={onCodeValidated}
        onBack={() => setPhase('no_invite')}
      />
    );
  }

  if (phase === 'has_invite') {
    return (
      <HasInviteScreen invitedBy={invitedBy} onContinue={navigateToSignup} />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: theme.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    flex: 1,
    backgroundColor: theme.BG,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  wordmark: {
    fontSize: 48,
    fontWeight: '800',
    color: theme.PRIMARY,
    letterSpacing: -1,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 17,
    color: theme.MUTED,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 280,
  },
  ctas: { gap: 12 },
  btn: {
    height: 56,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFilled: { backgroundColor: theme.PRIMARY },
  btnOutline: { borderWidth: 1.5, borderColor: theme.PRIMARY },
  btnFilledText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  btnOutlineText: { color: theme.PRIMARY, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.6 },
  // Lock / invite badges
  lockBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    backgroundColor: theme.SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  lockText: { fontSize: 14, color: theme.MUTED, fontWeight: '600' },
  invitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
  },
  invitedText: { fontSize: 15, color: theme.SUCCESS, fontWeight: '700' },
  // Code entry
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backText: { fontSize: 16, color: theme.TEXT },
  codeInput: {
    height: 56,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    borderRadius: 14,
    paddingHorizontal: 18,
    fontSize: 16,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
    letterSpacing: 1,
  },
  codeInputError: { borderColor: theme.ERROR },
  errorText: { fontSize: 13, color: theme.ERROR, textAlign: 'center' },
  // Text link
  textLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  textLinkText: { fontSize: 14, color: theme.MUTED },
});

import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { loginSchema } from '../../lib/validation';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { measure } from '../../lib/perf';
import { registerPushToken } from '../../lib/notifications';

const LOCKOUT_SECONDS = 30;
const MAX_FAILURES = 3;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failureCount, setFailureCount] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const lockoutRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockedUntilRef = useRef<number | null>(null);

  const isLocked = countdown > 0;

  // Countdown ticker — starts when lockout is triggered
  useEffect(() => {
    if (countdown <= 0) return;
    lockoutRef.current = setInterval(() => {
      const remaining = Math.ceil(((lockedUntilRef.current ?? 0) - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        setFailureCount(0);
        lockedUntilRef.current = null;
        if (lockoutRef.current) clearInterval(lockoutRef.current);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
    return () => { if (lockoutRef.current) clearInterval(lockoutRef.current); };
  }, [countdown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function triggerLockout() {
    lockedUntilRef.current = Date.now() + LOCKOUT_SECONDS * 1000;
    setCountdown(LOCKOUT_SECONDS);
  }

  async function handleLogin() {
    if (isLocked) return;

    // Validate inputs client-side before touching the network
    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      Toast.show({ type: 'error', text1: parsed.error.issues[0].message });
      return;
    }

    setLoading(true);
    try {
      await measure('auth.login', 'navigation', async () => {
        const { data, error } = await withRetry(() =>
          supabase.auth.signInWithPassword({
            email: parsed.data.email,
            password: parsed.data.password,
          }),
        );

        if (error) throw error;

        // Check account standing — suspended users are signed out immediately
        const { data: profile } = await supabase
          .from('users')
          .select('status')
          .eq('id', data.session.user.id)
          .single();

        if (profile?.status === 'suspended') {
          await supabase.auth.signOut();
          Toast.show({ type: 'error', text1: 'Account suspended', text2: 'Contact support for help.' });
          return;
        }

        // Fire-and-forget: register push token in the background
        registerPushToken(data.session.user.id);
        router.replace('/(tabs)/search');
      });
    } catch (err) {
      // Never surface raw error messages that might echo credentials back
      logger.error('Login attempt failed', err instanceof Error ? err.message : 'unknown');
      const next = failureCount + 1;
      setFailureCount(next);
      if (next >= MAX_FAILURES) triggerLockout();
      Toast.show({ type: 'error', text1: 'Invalid email or password' });
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    const trimmed = email.trim();
    if (!trimmed) {
      Toast.show({ type: 'info', text1: 'Enter your email above first' });
      return;
    }
    try {
      const { error } = await withRetry(() =>
        supabase.auth.resetPasswordForEmail(trimmed),
      );
      if (error) throw error;
      Toast.show({ type: 'success', text1: 'Password reset email sent' });
    } catch (err) {
      logger.error('Password reset failed', err);
      Toast.show({ type: 'error', text1: 'Could not send reset email' });
    }
  }

  const btnDisabled = loading || isLocked;

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your account</Text>
          </View>

          {/* Email */}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />

          {/* Password with visibility toggle */}
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor={theme.MUTED}
              secureTextEntry={!showPassword}
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />
            <Pressable
              style={styles.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={theme.MUTED}
              />
            </Pressable>
          </View>

          {/* Forgot password */}
          <Pressable style={styles.forgotWrap} onPress={handleForgotPassword}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          {/* Sign-in button */}
          <Pressable
            style={[styles.btn, btnDisabled && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={btnDisabled}
          >
            <Text style={styles.btnText}>
              {isLocked
                ? `Try again in ${countdown}s`
                : loading
                ? 'Signing in…'
                : 'Sign in'}
            </Text>
          </Pressable>

          {/* Sign up link */}
          <Pressable onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.switchText}>
              Don't have an account?{' '}
              <Text style={styles.switchLink}>Create one</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 12,
  },
  header: { marginBottom: 12, gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: theme.TEXT, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: theme.MUTED },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
  },
  passwordWrap: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 12,
    backgroundColor: theme.SURFACE,
    paddingLeft: 16,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    color: theme.TEXT,
  },
  eyeBtn: { paddingHorizontal: 14 },
  forgotWrap: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { fontSize: 14, color: theme.PRIMARY, fontWeight: '600' },
  btn: {
    height: 56,
    backgroundColor: theme.PRIMARY,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: theme.BG, fontSize: 17, fontWeight: '700' },
  switchText: { textAlign: 'center', color: theme.MUTED, fontSize: 14, marginTop: 8 },
  switchLink: { color: theme.PRIMARY, fontWeight: '600' },
});

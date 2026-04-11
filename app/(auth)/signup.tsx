import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle } from 'react-native-svg';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import {
  credentialsSchema,
  nameSchema,
  usernameSchema,
  bioSchema,
  citySchema,
  type City,
} from '../../lib/validation';
import { withRetry } from '../../lib/retry';
import { logger } from '../../lib/logger';
import { uploadAvatar } from '../../lib/storage';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Phase = 'credentials' | 'profile';
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const TOTAL_STEPS = 5;

const RING_SIZE = 104;
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const CITIES: { id: City; label: string; arabic: string; flag: string }[] = [
  { id: 'riyadh', label: 'Riyadh',  arabic: 'الرياض', flag: '🇸🇦' },
  { id: 'dubai',  label: 'Dubai',   arabic: 'دبي',    flag: '🇦🇪' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressDots({ step }: { step: number }) {
  return (
    <View style={dot.row}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <View key={i} style={[dot.dot, i + 1 === step && dot.active]} />
      ))}
    </View>
  );
}

const dot = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.BORDER },
  active: { backgroundColor: theme.PRIMARY, width: 24 },
});

function UploadRing({ progress }: { progress: number }) {
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
        stroke={theme.BORDER} strokeWidth={6} fill="none"
      />
      <Circle
        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
        stroke={theme.PRIMARY} strokeWidth={6} fill="none"
        strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        rotation={-90}
        origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
      />
    </Svg>
  );
}


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SignupScreen() {
  const params = useLocalSearchParams<{ code?: string }>();

  // Phase state
  const [phase, setPhase] = useState<Phase>('credentials');
  const [step, setStep] = useState(1);

  // Credentials phase
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState(params.code ?? '');

  // Step 1: Name
  const [name, setName] = useState('');

  // Step 2: Username
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3: Bio
  const [bio, setBio] = useState('');

  // Step 4: Avatar
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const uploadedUrlRef = useRef<string | null>(null);

  // Step 5: City
  const [city, setCity] = useState<City | null>(null);

  const [loading, setLoading] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────

  function advance() { setStep((s) => Math.min(s + 1, TOTAL_STEPS)); }
  function back() {
    if (step === 1) { setPhase('credentials'); return; }
    setStep((s) => s - 1);
  }

  // ── Credentials phase ─────────────────────────────────────────────────

  async function handleCreateAccount() {
    const parsed = credentialsSchema.safeParse({
      email: email.trim(),
      password,
      inviteCode: inviteCode.trim() || undefined,
    });
    if (!parsed.success) {
      Toast.show({ type: 'error', text1: parsed.error.issues[0].message });
      return;
    }

    // Validate invite code exists and is unused before paying the signUp cost
    if (parsed.data.inviteCode) {
      const { data: inv } = await supabase
        .from('invitations')
        .select('id, used_at, expires_at')
        .eq('code', parsed.data.inviteCode)
        .single();

      if (!inv) {
        Toast.show({ type: 'error', text1: 'Invalid invitation code' });
        return;
      }
      if (inv.used_at) {
        Toast.show({ type: 'error', text1: 'This invitation has already been used' });
        return;
      }
      if (new Date(inv.expires_at) < new Date()) {
        Toast.show({ type: 'error', text1: 'This invitation has expired' });
        return;
      }
    }

    setLoading(true);
    try {
      const { error } = await withRetry(() =>
        supabase.auth.signUp({
          // Only pass validated values — never log or surface raw user input
          email: parsed.data.email,
          password: parsed.data.password,
        }),
      );
      if (error) throw error;
      setPhase('profile');
      setStep(1);
    } catch (err) {
      logger.error('Signup failed', err instanceof Error ? err.message : 'unknown');
      Toast.show({ type: 'error', text1: 'Could not create account', text2: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: username availability check (debounced 500 ms) ────────────

  const checkUsername = useCallback(async (val: string) => {
    const parsed = usernameSchema.safeParse(val);
    if (!parsed.success) { setUsernameStatus('invalid'); return; }

    setUsernameStatus('checking');
    try {
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('username', val)
        .maybeSingle();
      setUsernameStatus(data ? 'taken' : 'available');
    } catch {
      setUsernameStatus('available'); // network error → optimistically allow, DB unique will catch
    }
  }, []);

  function handleUsernameChange(val: string) {
    setUsername(val);
    setUsernameStatus('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length >= 3) {
      debounceRef.current = setTimeout(() => checkUsername(val), 500);
    }
  }

  // ── Step 4: image picker ──────────────────────────────────────────────

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: 'Photo library access required' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    uploadedUrlRef.current = null; // reset any prior upload
    setUploadProgress(0);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUploading(true);
    try {
      const url = await uploadAvatar(asset.uri, user.id, setUploadProgress);
      uploadedUrlRef.current = url;
    } catch (err) {
      logger.error('Avatar upload failed', err);
      Toast.show({ type: 'error', text1: (err as Error).message });
      setPhotoUri(null);
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  }

  // ── Step validation guards ─────────────────────────────────────────────

  function canAdvance(): boolean {
    switch (step) {
      case 1: return nameSchema.safeParse(name).success;
      case 2: return usernameStatus === 'available';
      case 3: return true; // bio is optional (has Skip)
      case 4: return true; // avatar is optional
      case 5: return city !== null;
      default: return false;
    }
  }

  // ── Final submission (Step 5) ─────────────────────────────────────────

  async function handleFinish() {
    const cityParsed = citySchema.safeParse(city);
    if (!cityParsed.success) {
      Toast.show({ type: 'error', text1: 'Please select a city' });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired');

      // 1. Insert user profile row (id defaults to auth.uid() in DB)
      const insertResult = await withRetry<{ error: unknown }>(
        async () => supabase.from('users').insert({
          id: user.id,
          name: name.trim(),
          username,
          bio: bio.trim() || null,
          photo_url: uploadedUrlRef.current,
          city: cityParsed.data,
        }) as any,
      );
      if (insertResult.error) throw insertResult.error;

      // 2. Mark invitation code as used (best-effort — don't block on failure)
      const code = inviteCode.trim();
      if (code) {
        try {
          await (supabase
            .from('invitations')
            .update({ used_by: user.id, used_at: new Date().toISOString() })
            .eq('code', code)
            .is('used_at', null) as unknown as Promise<void>);
        } catch { /* silent — invitation was already validated earlier */ }
      }

      router.replace('/(tabs)/search');
    } catch (err) {
      logger.error('Profile creation failed', err);
      Toast.show({ type: 'error', text1: 'Failed to save profile', text2: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  // Credentials phase — shown before progress dots
  if (phase === 'credentials') {
    return (
      <SafeAreaView style={s.root}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={s.title}>Create account</Text>

            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={theme.MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />

            <View style={s.passwordWrap}>
              <TextInput
                style={s.passwordInput}
                placeholder="Password"
                placeholderTextColor={theme.MUTED}
                secureTextEntry={!showPassword}
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.MUTED} />
              </Pressable>
            </View>

            <TextInput
              style={s.input}
              placeholder="Invitation code (optional)"
              placeholderTextColor={theme.MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              value={inviteCode}
              onChangeText={setInviteCode}
            />

            <Pressable
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleCreateAccount}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={theme.BG} />
                : <Text style={s.btnText}>Continue</Text>}
            </Pressable>

            <Pressable onPress={() => router.push('/(auth)/login')}>
              <Text style={s.switchText}>
                Already have an account? <Text style={s.switchLink}>Sign in</Text>
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Profile phase — steps 1–5 with progress dots
  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Back nav */}
        <Pressable style={s.backBtn} onPress={back}>
          <Ionicons name="chevron-back" size={24} color={theme.TEXT} />
        </Pressable>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ProgressDots step={step} />

          {/* ── Step 1: Name ─────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <Text style={s.stepTitle}>What's your name?</Text>
              <TextInput
                style={s.input}
                placeholder="Your full name"
                placeholderTextColor={theme.MUTED}
                autoCorrect={false}
                textContentType="name"
                value={name}
                onChangeText={setName}
                autoFocus
              />
            </>
          )}

          {/* ── Step 2: Username ──────────────────────────────────────── */}
          {step === 2 && (
            <>
              <Text style={s.stepTitle}>Choose a username</Text>
              <View style={s.usernameWrap}>
                <Text style={s.atSign}>@</Text>
                <TextInput
                  style={s.usernameInput}
                  placeholder="username"
                  placeholderTextColor={theme.MUTED}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={handleUsernameChange}
                  autoFocus
                />
                {usernameStatus === 'checking' && (
                  <ActivityIndicator size="small" color={theme.MUTED} style={{ marginRight: 12 }} />
                )}
                {usernameStatus === 'available' && (
                  <Ionicons name="checkmark-circle" size={22} color={theme.SUCCESS} style={{ marginRight: 12 }} />
                )}
                {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                  <Ionicons name="close-circle" size={22} color={theme.ERROR} style={{ marginRight: 12 }} />
                )}
              </View>
              {usernameStatus === 'taken' && (
                <Text style={s.fieldError}>Username is already taken</Text>
              )}
              {usernameStatus === 'invalid' && (
                <Text style={s.fieldError}>Letters, numbers, dots and underscores only (3–30 chars)</Text>
              )}
            </>
          )}

          {/* ── Step 3: Bio ───────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <View style={s.stepHeader}>
                <Text style={s.stepTitle}>Add a bio</Text>
                <Pressable onPress={advance}>
                  <Text style={s.skipText}>Skip</Text>
                </Pressable>
              </View>
              <TextInput
                style={s.textarea}
                placeholder="Tell people a bit about yourself"
                placeholderTextColor={theme.MUTED}
                multiline
                maxLength={160}
                value={bio}
                onChangeText={setBio}
                textAlignVertical="top"
                autoFocus
              />
              <Text style={s.charCounter}>{bio.length}/160</Text>
            </>
          )}

          {/* ── Step 4: Avatar ────────────────────────────────────────── */}
          {step === 4 && (
            <>
              <View style={s.stepHeader}>
                <Text style={s.stepTitle}>Add a photo</Text>
                <Pressable onPress={advance}>
                  <Text style={s.skipText}>Skip</Text>
                </Pressable>
              </View>

              <View style={s.avatarSection}>
                {/* Ring + avatar image stacked */}
                <View style={s.ringWrap}>
                  {uploading && <UploadRing progress={uploadProgress} />}
                  <View style={[s.avatarCircle, { position: uploading ? 'absolute' : 'relative' }]}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={s.avatarImg} contentFit="cover" />
                    ) : (
                      <Ionicons name="person" size={40} color={theme.MUTED} />
                    )}
                  </View>
                </View>

                <Pressable
                  style={[s.chooseBtn, uploading && s.btnDisabled]}
                  onPress={pickAvatar}
                  disabled={uploading}
                >
                  <Text style={s.chooseBtnText}>
                    {uploading
                      ? `Uploading ${Math.round(uploadProgress * 100)}%`
                      : photoUri
                      ? 'Change photo'
                      : 'Choose photo'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* ── Step 5: City ──────────────────────────────────────────── */}
          {step === 5 && (
            <>
              <Text style={s.stepTitle}>Where are you based?</Text>
              <View style={s.cityRow}>
                {CITIES.map((c) => {
                  const selected = city === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={[s.cityCard, selected && s.cityCardSelected]}
                      onPress={() => setCity(c.id)}
                    >
                      {selected && (
                        <View style={s.cityCheck}>
                          <Ionicons name="checkmark" size={12} color={theme.BG} />
                        </View>
                      )}
                      <Text style={s.cityFlag}>{c.flag}</Text>
                      <Text style={s.cityArabic}>{c.arabic}</Text>
                      <Text style={[s.cityLabel, selected && s.cityLabelSelected]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Continue / Finish button ──────────────────────────────── */}
          <Pressable
            style={[s.btn, (!canAdvance() || loading) && s.btnDisabled]}
            onPress={step < TOTAL_STEPS ? advance : handleFinish}
            disabled={!canAdvance() || loading}
          >
            {loading
              ? <ActivityIndicator color={theme.BG} />
              : <Text style={s.btnText}>{step < TOTAL_STEPS ? 'Continue' : 'Get started'}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.BG },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40, gap: 14 },
  backBtn: { padding: 16, alignSelf: 'flex-start' },

  title: { fontSize: 28, fontWeight: '800', color: theme.TEXT, letterSpacing: -0.5, marginBottom: 8 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: theme.TEXT, marginBottom: 4 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skipText: { fontSize: 15, color: theme.PRIMARY, fontWeight: '600' },

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
  passwordInput: { flex: 1, fontSize: 16, color: theme.TEXT },
  eyeBtn: { paddingHorizontal: 14 },

  usernameWrap: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 12,
    backgroundColor: theme.SURFACE,
  },
  atSign: { paddingLeft: 14, fontSize: 16, color: theme.MUTED, fontWeight: '600' },
  usernameInput: { flex: 1, paddingLeft: 4, fontSize: 16, color: theme.TEXT },
  fieldError: { fontSize: 13, color: theme.ERROR, marginTop: -6 },

  textarea: {
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
    minHeight: 120,
  },
  charCounter: { alignSelf: 'flex-end', fontSize: 12, color: theme.MUTED, marginTop: -8 },

  avatarSection: { alignItems: 'center', gap: 20, paddingVertical: 12 },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  avatarImg: { width: 88, height: 88 },
  chooseBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: theme.PRIMARY,
  },
  chooseBtnText: { color: theme.PRIMARY, fontSize: 15, fontWeight: '600' },

  cityRow: { flexDirection: 'row', gap: 12 },
  cityCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.SURFACE,
  },
  cityCardSelected: { borderColor: theme.PRIMARY, backgroundColor: theme.PRIMARY_LIGHT },
  cityCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityFlag: { fontSize: 32 },
  cityArabic: { fontSize: 15, fontWeight: '700', color: theme.TEXT },
  cityLabel: { fontSize: 13, color: theme.MUTED, fontWeight: '500' },
  cityLabelSelected: { color: theme.PRIMARY },

  btn: {
    height: 56,
    backgroundColor: theme.PRIMARY,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: theme.BG, fontSize: 17, fontWeight: '700' },

  switchText: { textAlign: 'center', color: theme.MUTED, fontSize: 14, marginTop: 4 },
  switchLink: { color: theme.PRIMARY, fontWeight: '600' },
});

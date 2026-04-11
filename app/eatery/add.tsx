import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { eateryAddSchema } from '../../lib/validation';
import { logger } from '../../lib/logger';
import { uploadImage } from '../../lib/storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PhotoEntry {
  uri: string;
  progress: number; // 0–1
  publicUrl: string | null;
  error: boolean;
}

type City = 'riyadh' | 'dubai';

const MAX_PHOTOS = 4;

// ---------------------------------------------------------------------------
// Photo strip
// ---------------------------------------------------------------------------

function PhotoStrip({
  photos,
  onAdd,
  onRemove,
}: {
  photos: PhotoEntry[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
      <View style={ph.row}>
        {photos.map((p, i) => (
          <View key={i} style={ph.slot}>
            <Image source={{ uri: p.uri }} style={ph.thumb} contentFit="cover" />
            {/* Progress overlay */}
            {p.publicUrl === null && !p.error && (
              <View style={ph.overlay}>
                {p.progress > 0 ? (
                  <Text style={ph.pct}>{Math.round(p.progress * 100)}%</Text>
                ) : (
                  <ActivityIndicator size="small" color="#fff" />
                )}
              </View>
            )}
            {p.error && (
              <View style={[ph.overlay, ph.errorOverlay]}>
                <Ionicons name="alert-circle-outline" size={18} color="#fff" />
              </View>
            )}
            <Pressable style={ph.remove} onPress={() => onRemove(i)} hitSlop={6}>
              <Ionicons name="close-circle" size={20} color="#fff" />
            </Pressable>
          </View>
        ))}
        {photos.length < MAX_PHOTOS && (
          <Pressable style={ph.addBtn} onPress={onAdd}>
            <Ionicons name="camera-outline" size={26} color={theme.MUTED} />
            <Text style={ph.addText}>Add photo</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const ph = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 20 },
  slot: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumb: { width: 96, height: 96 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorOverlay: { backgroundColor: 'rgba(239,68,68,0.6)' },
  pct: { color: '#fff', fontSize: 14, fontWeight: '700' },
  remove: { position: 'absolute', top: 4, right: 4 },
  addBtn: {
    width: 96,
    height: 96,
    borderRadius: 10,
    backgroundColor: theme.SURFACE,
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addText: { fontSize: 11, color: theme.MUTED },
});

// ---------------------------------------------------------------------------
// City card
// ---------------------------------------------------------------------------

function CityCard({
  city,
  label,
  flag,
  subtitle,
  selected,
  onPress,
}: {
  city: City;
  label: string;
  flag: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cc.card, selected && cc.cardSelected]} onPress={onPress}>
      <Text style={cc.flag}>{flag}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[cc.label, selected && cc.labelSelected]}>{label}</Text>
        <Text style={cc.subtitle}>{subtitle}</Text>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={22} color={theme.PRIMARY} />}
    </Pressable>
  );
}

const cc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    backgroundColor: theme.SURFACE,
  },
  cardSelected: { borderColor: theme.PRIMARY, backgroundColor: theme.PRIMARY_LIGHT },
  flag: { fontSize: 28 },
  label: { fontSize: 15, fontWeight: '700', color: theme.TEXT },
  labelSelected: { color: theme.PRIMARY_DARK },
  subtitle: { fontSize: 12, color: theme.MUTED, marginTop: 2 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

// City-centre fallback coordinates when no map pin is provided
const CITY_CENTERS: Record<City, { lat: number; lng: number }> = {
  riyadh: { lat: 24.7136, lng: 46.6753 },
  dubai:  { lat: 25.2048, lng: 55.2708 },
};

export default function AddEateryScreen() {
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const prefillLat = params.lat ? parseFloat(params.lat) : null;
  const prefillLng = params.lng ? parseFloat(params.lng) : null;
  const hasPinCoords = prefillLat !== null && prefillLng !== null;

  const [name, setName] = useState('');
  const [locationText, setLocationText] = useState('');
  const [city, setCity] = useState<City | null>(null);
  const [website, setWebsite] = useState('');
  const [menuUrl, setMenuUrl] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ── Photo picking ────────────────────────────────────────────────────────

  async function pickPhotos() {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });

    if (result.canceled || !result.assets.length) return;

    const newEntries: PhotoEntry[] = result.assets.map((a) => ({
      uri: a.uri,
      progress: 0,
      publicUrl: null,
      error: false,
    }));

    setPhotos((prev) => [...prev, ...newEntries]);
    uploadAll(newEntries, photos.length);
  }

  async function uploadAll(entries: PhotoEntry[], startIdx: number) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    entries.forEach((entry, localIdx) => {
      const globalIdx = startIdx + localIdx;
      const path = `${user.id}/${Date.now()}_${globalIdx}.jpg`;

      uploadImage('eateries', path, entry.uri, (fraction) => {
        setPhotos((prev) =>
          prev.map((p, i) => (i === globalIdx ? { ...p, progress: fraction } : p)),
        );
      })
        .then((url) => {
          setPhotos((prev) =>
            prev.map((p, i) => (i === globalIdx ? { ...p, publicUrl: url, progress: 1 } : p)),
          );
        })
        .catch((e) => {
          logger.error('Photo upload failed', e);
          setPhotos((prev) =>
            prev.map((p, i) => (i === globalIdx ? { ...p, error: true } : p)),
          );
        });
    });
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    const uploadedUrls = photos.filter((p) => p.publicUrl).map((p) => p.publicUrl!);
    const uploading = photos.some((p) => p.publicUrl === null && !p.error);

    if (uploading) {
      Toast.show({ type: 'error', text1: 'Photos still uploading', text2: 'Please wait.' });
      return;
    }

    // Resolve coordinates: prefer map-pin, fall back to city centre
    const resolvedLat = prefillLat ?? (city ? CITY_CENTERS[city].lat : null);
    const resolvedLng = prefillLng ?? (city ? CITY_CENTERS[city].lng : null);

    const result = eateryAddSchema.safeParse({
      name: name.trim(),
      location_text: locationText.trim(),
      city: city ?? undefined,
      latitude: resolvedLat,
      longitude: resolvedLng,
      website: website.trim() || undefined,
      menu_url: menuUrl.trim() || undefined,
    });

    if (!result.success) {
      Toast.show({ type: 'error', text1: result.error.issues[0].message });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('eateries').insert({
        ...result.data,
        photos: uploadedUrls,
        is_verified: false,
      });
      if (error) throw error;

      Toast.show({
        type: 'success',
        text1: 'Thanks!',
        text2: 'Your eatery will appear once verified.',
      });
      router.back();
    } catch (e) {
      logger.error('Add eatery failed', e);
      Toast.show({ type: 'error', text1: 'Failed to add eatery' });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = name.trim().length > 0 && locationText.trim().length > 0 && !!city;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
        </Pressable>
        <Text style={s.headerTitle}>Add a place</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Photos */}
        <Text style={s.sectionLabel}>Photos</Text>
        <PhotoStrip photos={photos} onAdd={pickPhotos} onRemove={removePhoto} />
        <Text style={s.photoHint}>Up to {MAX_PHOTOS} photos · JPEG or PNG · max 5 MB each</Text>

        {/* Name */}
        <Text style={s.sectionLabel}>Restaurant name <Text style={s.required}>*</Text></Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Nusr-Et"
          placeholderTextColor={theme.MUTED}
          maxLength={80}
        />

        {/* Address */}
        <Text style={s.sectionLabel}>Address <Text style={s.required}>*</Text></Text>
        <TextInput
          style={s.input}
          value={locationText}
          onChangeText={setLocationText}
          placeholder="e.g. Al Faisaliah Tower, Riyadh"
          placeholderTextColor={theme.MUTED}
          maxLength={160}
        />

        {/* Location source note */}
        {hasPinCoords ? (
          <View style={s.pinNote}>
            <Ionicons name="location" size={14} color={theme.PRIMARY} />
            <Text style={s.pinNoteText}>Location pinned from map</Text>
          </View>
        ) : (
          <Text style={s.pinHint}>
            Coordinates will be set to your selected city's centre. For a precise pin, use the map.
          </Text>
        )}

        {/* City */}
        <Text style={s.sectionLabel}>City <Text style={s.required}>*</Text></Text>
        <View style={s.cityRow}>
          <CityCard
            city="riyadh"
            label="Riyadh"
            flag="🇸🇦"
            subtitle="المملكة العربية السعودية"
            selected={city === 'riyadh'}
            onPress={() => setCity('riyadh')}
          />
          <CityCard
            city="dubai"
            label="Dubai"
            flag="🇦🇪"
            subtitle="الإمارات العربية المتحدة"
            selected={city === 'dubai'}
            onPress={() => setCity('dubai')}
          />
        </View>

        {/* Website (optional) */}
        <Text style={s.sectionLabel}>Website</Text>
        <TextInput
          style={s.input}
          value={website}
          onChangeText={setWebsite}
          placeholder="https://…"
          placeholderTextColor={theme.MUTED}
          autoCapitalize="none"
          keyboardType="url"
          maxLength={300}
        />

        {/* Menu URL (optional) */}
        <Text style={s.sectionLabel}>Menu URL</Text>
        <TextInput
          style={s.input}
          value={menuUrl}
          onChangeText={setMenuUrl}
          placeholder="https://…"
          placeholderTextColor={theme.MUTED}
          autoCapitalize="none"
          keyboardType="url"
          maxLength={300}
        />

        {/* Submit */}
        <Pressable
          style={[s.btn, (!canSubmit || submitting) && s.btnDisabled]}
          disabled={!canSubmit || submitting}
          onPress={handleSubmit}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Submit for review</Text>
          }
        </Pressable>

        <Text style={s.disclaimer}>
          Eateries are reviewed by the Hala team before appearing in search.
        </Text>
      </ScrollView>
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
    paddingVertical: 10,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: theme.TEXT },
  content: { paddingBottom: 40, gap: 8 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 20,
    marginTop: 16,
  },
  required: { color: theme.ERROR },
  photoHint: { fontSize: 12, color: theme.MUTED, marginHorizontal: 20 },
  input: {
    marginHorizontal: 20,
    height: 52,
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
  },
  cityRow: { marginHorizontal: 20, gap: 10 },
  btn: {
    marginHorizontal: 20,
    marginTop: 24,
    height: 52,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  disclaimer: {
    fontSize: 12,
    color: theme.MUTED,
    textAlign: 'center',
    marginHorizontal: 20,
    marginTop: 8,
    lineHeight: 18,
  },
  pinNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginTop: 4,
  },
  pinNoteText: { fontSize: 12, color: theme.PRIMARY, fontWeight: '600' },
  pinHint: { fontSize: 12, color: theme.MUTED, marginHorizontal: 20, marginTop: 4, lineHeight: 17 },
});

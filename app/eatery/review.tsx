import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Toast from 'react-native-toast-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { measure } from '../../lib/perf';
import { sanitizeText } from '../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4;

interface EateryOption {
  id: string;
  name: string;
  location_text: string;
  photos: string[];
}

interface RankedItem {
  id: string;
  eatery_id: string;
  name: string;
  location_text: string;
  photos: string[];
  rank: number;
  isNew?: boolean;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ step }: { step: Step }) {
  return (
    <View style={pb.track}>
      {([1, 2, 3, 4] as Step[]).map((s) => (
        <View
          key={s}
          style={[pb.segment, s <= step && pb.filled, s === step && pb.active]}
        />
      ))}
    </View>
  );
}

const pb = StyleSheet.create({
  track: { flexDirection: 'row', gap: 4, marginHorizontal: 20, marginVertical: 12 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.BORDER },
  filled: { backgroundColor: theme.PRIMARY_LIGHT },
  active: { backgroundColor: theme.PRIMARY },
});

// ---------------------------------------------------------------------------
// Step 1 — Select eatery
// ---------------------------------------------------------------------------

function StepSelectEatery({
  initial,
  onSelect,
}: {
  initial: EateryOption | null;
  onSelect: (e: EateryOption) => void;
}) {
  const [query, setQuery] = useState(initial?.name ?? '');
  const [results, setResults] = useState<EateryOption[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initial) setResults([initial]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onChangeText(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => search(text.trim()), 400);
  }

  async function search(q: string) {
    setSearching(true);
    try {
      const { data } = await supabase
        .from('eateries')
        .select('id, name, location_text, photos')
        .ilike('name', `%${q}%`)
        .limit(15);
      setResults((data ?? []) as EateryOption[]);
    } catch (e) {
      logger.error('Eatery search failed', e);
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Text style={ss.stepTitle}>Which eatery?</Text>
      <View style={ss.searchBox}>
        <Ionicons name="search-outline" size={18} color={theme.MUTED} />
        <TextInput
          style={ss.searchInput}
          value={query}
          onChangeText={onChangeText}
          placeholder="Search eateries…"
          placeholderTextColor={theme.MUTED}
          autoFocus
          returnKeyType="search"
        />
        {searching && <ActivityIndicator size="small" color={theme.PRIMARY} />}
      </View>

      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <Pressable style={ss.addNew} onPress={() => router.push('/eatery/add')}>
            <Ionicons name="add-circle-outline" size={20} color={theme.PRIMARY} />
            <Text style={ss.addNewText}>Add new eatery</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={ss.eateryRow} onPress={() => onSelect(item)}>
            {item.photos?.[0] ? (
              <Image
                source={{ uri: item.photos[0] }}
                style={ss.eateryThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[ss.eateryThumb, ss.eateryThumbPlaceholder]}>
                <Ionicons name="restaurant-outline" size={20} color={theme.BORDER} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={ss.eateryName}>{item.name}</Text>
              <Text style={ss.eateryLocation}>{item.location_text}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.MUTED} />
          </Pressable>
        )}
      />
    </View>
  );
}

const ss = StyleSheet.create({
  stepTitle: { fontSize: 20, fontWeight: '800', color: theme.TEXT, marginHorizontal: 20, marginBottom: 16 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  searchInput: { flex: 1, fontSize: 15, color: theme.TEXT },
  eateryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.BORDER,
  },
  eateryThumb: { width: 48, height: 48, borderRadius: 8 },
  eateryThumbPlaceholder: {
    backgroundColor: theme.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  eateryName: { fontSize: 14, fontWeight: '700', color: theme.TEXT },
  eateryLocation: { fontSize: 12, color: theme.MUTED, marginTop: 2 },
  addNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  addNewText: { fontSize: 14, fontWeight: '600', color: theme.PRIMARY },
});

// ---------------------------------------------------------------------------
// Step 2 — Write review
// ---------------------------------------------------------------------------

function StepWriteReview({
  value,
  onChange,
  onSkip,
}: {
  value: string;
  onChange: (v: string) => void;
  onSkip: () => void;
}) {
  const MAX = 500;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={ss.stepTitle}>Your review</Text>
      <View style={wr.box}>
        <TextInput
          style={wr.input}
          value={value}
          onChangeText={(t) => onChange(t.slice(0, MAX))}
          placeholder="What did you think? (optional)"
          placeholderTextColor={theme.MUTED}
          multiline
          maxLength={MAX}
          autoFocus
          textAlignVertical="top"
        />
        <Text style={wr.counter}>{value.length}/{MAX}</Text>
      </View>
      <Pressable style={wr.skip} onPress={onSkip}>
        <Text style={wr.skipText}>Skip this step</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const wr = StyleSheet.create({
  box: {
    marginHorizontal: 20,
    backgroundColor: theme.SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.BORDER,
    padding: 14,
    minHeight: 160,
  },
  input: { fontSize: 15, color: theme.TEXT, flex: 1, minHeight: 130 },
  counter: { fontSize: 11, color: theme.MUTED, textAlign: 'right', marginTop: 8 },
  skip: { marginTop: 16, alignItems: 'center' },
  skipText: { fontSize: 14, color: theme.MUTED },
});

// ---------------------------------------------------------------------------
// Step 3 — Favourite dish
// ---------------------------------------------------------------------------

function StepFavouriteDish({
  value,
  onChange,
  onSkip,
}: {
  value: string;
  onChange: (v: string) => void;
  onSkip: () => void;
}) {
  const MAX = 100;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={ss.stepTitle}>Favourite dish?</Text>
      <Text style={fd.subtitle}>What would you recommend?</Text>
      <View style={fd.box}>
        <TextInput
          style={fd.input}
          value={value}
          onChangeText={(t) => onChange(t.slice(0, MAX))}
          placeholder="e.g. Wagyu smash burger"
          placeholderTextColor={theme.MUTED}
          maxLength={MAX}
          autoFocus
          returnKeyType="done"
        />
        <Text style={fd.counter}>{value.length}/{MAX}</Text>
      </View>
      <Pressable style={wr.skip} onPress={onSkip}>
        <Text style={wr.skipText}>Skip this step</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const fd = StyleSheet.create({
  subtitle: { fontSize: 14, color: theme.MUTED, marginHorizontal: 20, marginBottom: 16, marginTop: -8 },
  box: {
    marginHorizontal: 20,
    backgroundColor: theme.SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.BORDER,
    padding: 14,
  },
  input: { fontSize: 15, color: theme.TEXT },
  counter: { fontSize: 11, color: theme.MUTED, textAlign: 'right', marginTop: 8 },
});

// ---------------------------------------------------------------------------
// Step 4 — Drag to rank
// ---------------------------------------------------------------------------

function StepRanking({
  eateryName,
  items,
  onReorder,
}: {
  eateryName: string;
  items: RankedItem[];
  onReorder: (next: RankedItem[]) => void;
}) {
  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<RankedItem>) => (
      <ScaleDecorator>
        <Pressable
          onLongPress={drag}
          disabled={isActive}
          style={[rk.row, item.isNew && rk.rowNew, isActive && rk.rowActive]}
        >
          <View style={[rk.rankBadge, item.isNew && rk.rankBadgeNew]}>
            <Text style={[rk.rankText, item.isNew && rk.rankTextNew]}>
              {items.indexOf(item) + 1}
            </Text>
          </View>
          {item.photos?.[0] ? (
            <Image
              source={{ uri: item.photos[0] }}
              style={rk.thumb}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[rk.thumb, rk.thumbPlaceholder]}>
              <Ionicons name="restaurant-outline" size={16} color={theme.BORDER} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[rk.name, item.isNew && rk.nameNew]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={rk.location} numberOfLines={1}>{item.location_text}</Text>
          </View>
          {item.isNew ? (
            <View style={rk.newChip}>
              <Text style={rk.newChipText}>New</Text>
            </View>
          ) : (
            <Ionicons name="menu-outline" size={20} color={theme.MUTED} />
          )}
        </Pressable>
      </ScaleDecorator>
    ),
    [items],
  );

  return (
    <View style={{ flex: 1 }}>
      <Text style={ss.stepTitle}>Where does {eateryName} rank for you?</Text>
      <Text style={[fd.subtitle, { marginTop: -8 }]}>Long-press and drag to reorder</Text>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <DraggableFlatList
          data={items}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data }) => onReorder(data)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </GestureHandlerRootView>
    </View>
  );
}

const rk = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.BG,
    borderBottomWidth: 1,
    borderBottomColor: theme.BORDER,
  },
  rowNew: { backgroundColor: theme.PRIMARY_LIGHT },
  rowActive: { opacity: 0.9, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8 },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeNew: { backgroundColor: theme.PRIMARY },
  rankText: { fontSize: 13, fontWeight: '700', color: theme.MUTED },
  rankTextNew: { color: '#fff' },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  thumbPlaceholder: {
    backgroundColor: theme.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  name: { fontSize: 14, fontWeight: '700', color: theme.TEXT },
  nameNew: { color: theme.PRIMARY_DARK },
  location: { fontSize: 12, color: theme.MUTED, marginTop: 2 },
  newChip: {
    backgroundColor: theme.PRIMARY,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newChipText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ReviewScreen() {
  const params = useLocalSearchParams<{ eateryId?: string; eateryName?: string }>();

  const [step, setStep] = useState<Step>(params.eateryId ? 2 : 1);
  const [selectedEatery, setSelectedEatery] = useState<EateryOption | null>(
    params.eateryId
      ? { id: params.eateryId, name: params.eateryName ?? '', location_text: '', photos: [] }
      : null,
  );
  const [reviewText, setReviewText] = useState('');
  const [favouriteDish, setFavouriteDish] = useState('');
  const [rankedItems, setRankedItems] = useState<RankedItem[]>([]);
  const [loadingRanks, setLoadingRanks] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updateModal, setUpdateModal] = useState(false);
  const existingReviewIdRef = useRef<string | null>(null);

  // When entering step 4, load the user's existing ranked eateries
  useEffect(() => {
    if (step === 4 && selectedEatery) {
      loadRankedEateries();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRankedEateries() {
    if (!selectedEatery) return;
    setLoadingRanks(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('reviews')
        .select('id, rank, eatery_id, eateries(id, name, location_text, photos)')
        .eq('user_id', user.id)
        .order('rank', { ascending: true });

      const existing = ((data ?? []) as unknown as {
        id: string;
        rank: number;
        eatery_id: string;
        eateries: { id: string; name: string; location_text: string; photos: string[] };
      }[]).map((r) => ({
        id: r.id,
        eatery_id: r.eatery_id,
        name: r.eateries.name,
        location_text: r.eateries.location_text,
        photos: r.eateries.photos ?? [],
        rank: r.rank,
        isNew: false,
      }));

      // Check if user already reviewed this eatery
      const existingIdx = existing.findIndex((r) => r.eatery_id === selectedEatery.id);
      if (existingIdx !== -1) {
        existingReviewIdRef.current = existing[existingIdx].id;
      }

      if (existingIdx !== -1) {
        // Replace existing entry with new highlighted version in place
        existing[existingIdx] = { ...existing[existingIdx], isNew: true };
        setRankedItems(existing);
      } else {
        // Insert the new eatery at the top (rank 1 position)
        const newItem: RankedItem = {
          id: `new-${selectedEatery.id}`,
          eatery_id: selectedEatery.id,
          name: selectedEatery.name,
          location_text: selectedEatery.location_text,
          photos: selectedEatery.photos,
          rank: 1,
          isNew: true,
        };
        setRankedItems([newItem, ...existing]);
      }
    } catch (e) {
      logger.error('Failed to load ranked eateries', e);
    } finally {
      setLoadingRanks(false);
    }
  }

  function handleSelectEatery(eatery: EateryOption) {
    setSelectedEatery(eatery);
    setStep(2);
  }

  function goBack() {
    if (step === 1) { router.back(); return; }
    setStep((s) => (s - 1) as Step);
  }

  function goNext() {
    setStep((s) => (s + 1) as Step);
  }

  async function submit() {
    if (!selectedEatery) return;
    setSubmitting(true);
    try {
      await measure('review.submit', 'navigation', async () => {
        const newItem = rankedItems.find((r) => r.isNew);
        const rank = newItem ? rankedItems.indexOf(newItem) + 1 : 1;

        const cleanText = reviewText.trim() ? sanitizeText(reviewText) : null;
        const cleanDish = favouriteDish.trim() ? sanitizeText(favouriteDish) : null;

        // If we detected an existing review during rank loading, prompt to update
        if (existingReviewIdRef.current) {
          setUpdateModal(true);
          setSubmitting(false);
          return;
        }

        const { error } = await supabase.rpc('insert_review_with_rank', {
          p_eatery_id: selectedEatery!.id,
          p_text: cleanText,
          p_favourite_dish: cleanDish,
          p_rank: rank,
        });

        if (error) {
          // UNIQUE constraint violation — duplicate review
          if (error.code === '23505') {
            setUpdateModal(true);
            setSubmitting(false);
            return;
          }
          throw error;
        }

        Toast.show({ type: 'success', text1: 'Review submitted!', text2: `${selectedEatery!.name} added to your list.` });
        router.back();
      });
    } catch (e) {
      logger.error('Failed to submit review', e);
      Toast.show({ type: 'error', text1: 'Could not submit review' });
    } finally {
      setSubmitting(false);
    }
  }

  async function updateExistingReview() {
    if (!existingReviewIdRef.current || !selectedEatery) return;
    setUpdateModal(false);
    setSubmitting(true);
    try {
      const newItem = rankedItems.find((r) => r.isNew);
      const rank = newItem ? rankedItems.indexOf(newItem) + 1 : 1;
      const cleanText = reviewText.trim() ? sanitizeText(reviewText) : null;
      const cleanDish = favouriteDish.trim() ? sanitizeText(favouriteDish) : null;

      const { error } = await supabase.rpc('update_review_with_rank', {
        p_review_id: existingReviewIdRef.current,
        p_text: cleanText,
        p_favourite_dish: cleanDish,
        p_new_rank: rank,
      });
      if (error) throw error;

      Toast.show({ type: 'success', text1: 'Review updated!' });
      router.back();
    } catch (e) {
      logger.error('Failed to update review', e);
      Toast.show({ type: 'error', text1: 'Could not update review' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const canProceed = useMemo(() => {
    if (step === 1) return !!selectedEatery;
    if (step === 4) return rankedItems.length > 0 && !loadingRanks;
    return true;
  }, [step, selectedEatery, rankedItems, loadingRanks]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={goBack} hitSlop={8}>
          {step === 1 ? (
            <Text style={s.cancel}>Cancel</Text>
          ) : (
            <Ionicons name="chevron-back" size={22} color={theme.TEXT} />
          )}
        </Pressable>
        <Text style={s.headerTitle}>
          {step === 1 && 'New review'}
          {step === 2 && (selectedEatery?.name ?? 'Review')}
          {step === 3 && 'Favourite dish'}
          {step === 4 && 'Your ranking'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ProgressBar step={step} />

      {/* Step content */}
      <View style={{ flex: 1 }}>
        {step === 1 && (
          <StepSelectEatery initial={selectedEatery} onSelect={handleSelectEatery} />
        )}
        {step === 2 && (
          <StepWriteReview
            value={reviewText}
            onChange={setReviewText}
            onSkip={goNext}
          />
        )}
        {step === 3 && (
          <StepFavouriteDish
            value={favouriteDish}
            onChange={setFavouriteDish}
            onSkip={goNext}
          />
        )}
        {step === 4 && (
          loadingRanks
            ? <View style={s.center}><ActivityIndicator color={theme.PRIMARY} /></View>
            : <StepRanking
                eateryName={selectedEatery?.name ?? ''}
                items={rankedItems}
                onReorder={setRankedItems}
              />
        )}
      </View>

      {/* Footer CTA (shown on steps 2–4) */}
      {step > 1 && (
        <View style={s.footer}>
          <Pressable
            style={[s.btn, !canProceed && s.btnDisabled]}
            disabled={!canProceed || submitting}
            onPress={step === 4 ? submit : goNext}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{step === 4 ? 'Submit' : 'Next'}</Text>
            }
          </Pressable>
        </View>
      )}

      {/* Update existing review modal */}
      <Modal visible={updateModal} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <Text style={m.title}>Already reviewed</Text>
            <Text style={m.body}>
              You've already reviewed {selectedEatery?.name}. Would you like to update your existing review?
            </Text>
            <Pressable style={m.primary} onPress={updateExistingReview}>
              <Text style={m.primaryText}>Update review</Text>
            </Pressable>
            <Pressable style={m.secondary} onPress={() => setUpdateModal(false)}>
              <Text style={m.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 8,
  },
  cancel: { fontSize: 16, color: theme.MUTED },
  headerTitle: { fontSize: 16, fontWeight: '700', color: theme.TEXT },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 20, paddingBottom: 8, paddingTop: 12 },
  btn: {
    height: 52,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.TEXT },
  body: { fontSize: 14, color: theme.MUTED, lineHeight: 20 },
  primary: {
    height: 50,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, color: theme.MUTED },
});

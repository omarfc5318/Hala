// components/ReportSheet.tsx
// Bottom sheet for reporting a review, eatery, or user.
// Usage:
//   const reportRef = useRef<ReportSheetRef>(null);
//   <ReportSheet ref={reportRef} />
//   reportRef.current?.open({ entityType: 'review', entityId: '...' });

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import Toast from 'react-native-toast-message';
import { theme } from '../lib/theme';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = 'review' | 'eatery' | 'user';
type Reason     = 'spam' | 'offensive' | 'fake' | 'other';

interface ReportTarget {
  entityType: EntityType;
  entityId:   string;
}

export interface ReportSheetRef {
  open: (target: ReportTarget) => void;
}

const REASONS: { value: Reason; label: string }[] = [
  { value: 'spam',      label: 'Spam'      },
  { value: 'offensive', label: 'Offensive' },
  { value: 'fake',      label: 'Fake'      },
  { value: 'other',     label: 'Other'     },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ReportSheet = forwardRef<ReportSheetRef>((_, ref) => {
  const sheetRef = useRef<BottomSheet>(null);

  const [target,     setTarget]     = useState<ReportTarget | null>(null);
  const [reason,     setReason]     = useState<Reason | null>(null);
  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  useImperativeHandle(ref, () => ({
    open(t: ReportTarget) {
      setTarget(t);
      setReason(null);
      setNotes('');
      sheetRef.current?.expand();
    },
  }));

  function handleClose() {
    sheetRef.current?.close();
  }

  async function handleSubmit() {
    if (!target || !reason) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Toast.show({ type: 'error', text1: 'You must be signed in to report content' });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        entity_type: target.entityType,
        entity_id:   target.entityId,
        reason,
        notes:       notes.trim() || null,
      });

      if (error) {
        // 23505 = unique violation — user already reported this entity
        if (error.code === '23505') {
          Toast.show({ type: 'info', text1: 'Already reported', text2: 'You\'ve already flagged this content.' });
        } else {
          throw error;
        }
      } else {
        Toast.show({
          type:  'success',
          text1: 'Report submitted',
          text2: 'Thank you — we\'ll review this within 24 hours.',
        });
      }

      handleClose();
    } catch (e) {
      logger.error('Failed to submit report', e);
      Toast.show({ type: 'error', text1: 'Could not submit report. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="close" />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['55%']}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: theme.BORDER }}
      backgroundStyle={{ backgroundColor: theme.BG }}
    >
      <BottomSheetView style={s.content}>
        <Text style={s.title}>Report content</Text>
        <Text style={s.subtitle}>Select a reason and we'll review it promptly.</Text>

        {/* Reason chips */}
        <View style={s.reasons}>
          {REASONS.map((r) => (
            <Pressable
              key={r.value}
              style={[s.chip, reason === r.value && s.chipActive]}
              onPress={() => setReason(r.value)}
              accessibilityRole="radio"
              accessibilityLabel={r.label}
              accessibilityState={{ checked: reason === r.value }}
            >
              <Text style={[s.chipText, reason === r.value && s.chipTextActive]}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Notes */}
        <TextInput
          style={s.notes}
          placeholder="Additional details (optional)"
          placeholderTextColor={theme.MUTED}
          multiline
          textAlignVertical="top"
          value={notes}
          onChangeText={(t) => setNotes(t.slice(0, 500))}
          accessibilityLabel="Additional details"
          accessibilityHint="Describe the issue in up to 500 characters"
        />
        <Text style={s.counter}>{notes.length}/500</Text>

        {/* Actions */}
        <View style={s.btnRow}>
          <Pressable
            style={s.cancelBtn}
            onPress={handleClose}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>

          <Pressable
            style={[s.submitBtn, (!reason || submitting) && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!reason || submitting}
            accessibilityRole="button"
            accessibilityLabel="Submit report"
            accessibilityState={{ disabled: !reason || submitting }}
          >
            {submitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.submitText}>Submit Report</Text>}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
});

ReportSheet.displayName = 'ReportSheet';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingBottom: 32, gap: 14 },
  title:    { fontSize: 18, fontWeight: '700', color: theme.TEXT },
  subtitle: { fontSize: 14, color: theme.MUTED, marginTop: -8 },

  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    backgroundColor: theme.SURFACE,
  },
  chipActive:     { borderColor: theme.PRIMARY, backgroundColor: theme.PRIMARY_LIGHT },
  chipText:       { fontSize: 14, fontWeight: '600', color: theme.MUTED },
  chipTextActive: { color: theme.PRIMARY },

  notes: {
    height: 88,
    borderWidth: 1,
    borderColor: theme.BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    fontSize: 14,
    color: theme.TEXT,
    backgroundColor: theme.SURFACE,
  },
  counter: { fontSize: 11, color: theme.MUTED, textAlign: 'right', marginTop: -10 },

  btnRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: theme.TEXT },
  submitBtn: {
    flex: 2,
    height: 48,
    borderRadius: 999,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitText:        { fontSize: 15, fontWeight: '700', color: '#fff' },
});

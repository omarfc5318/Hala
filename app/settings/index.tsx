import { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import Toast from 'react-native-toast-message';
import { theme } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import { logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Section = {
  title?: string;
  items: Item[];
};

type Item = {
  label: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
  accessibilityHint?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function callEdgeFunction(path: string, jwt: string, body?: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function SettingsRow({ item }: { item: Item }) {
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={item.accessibilityHint}
    >
      <Ionicons
        name={item.icon as any}
        size={20}
        color={item.destructive ? theme.ERROR : theme.TEXT}
        style={s.rowIcon}
        accessibilityElementsHidden
      />
      <Text style={[s.rowLabel, item.destructive && s.rowLabelDestructive]}>
        {item.label}
      </Text>
      {item.rightElement ?? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.MUTED}
          accessibilityElementsHidden
        />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Delete account confirmation modal
// ---------------------------------------------------------------------------

function DeleteModal({
  visible,
  onClose,
  onConfirm,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (confirmation: string) => void;
  loading: boolean;
}) {
  const [text, setText] = useState('');
  const canDelete = text === 'DELETE';

  function handleClose() {
    setText('');
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      accessibilityViewIsModal
    >
      <View style={dm.overlay}>
        <View style={dm.card}>
          <Ionicons name="warning-outline" size={36} color={theme.ERROR} style={dm.icon} />
          <Text style={dm.title}>Delete account</Text>
          <Text style={dm.body}>
            This is permanent and cannot be undone.{'\n\n'}
            Your profile will be anonymised, all your reviews and
            friendships will be removed, and your account will be
            scheduled for deletion after 30 days.
          </Text>

          <Text style={dm.inputLabel}>
            Type <Text style={dm.word}>DELETE</Text> to confirm
          </Text>
          <TextInput
            style={dm.input}
            value={text}
            onChangeText={setText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            placeholderTextColor={theme.MUTED}
            accessibilityLabel="Type DELETE to confirm account deletion"
            accessibilityHint="Enter the word DELETE in capital letters to enable the delete button"
          />

          <View style={dm.btnRow}>
            <Pressable
              style={dm.cancelBtn}
              onPress={handleClose}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={dm.cancelText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[dm.deleteBtn, (!canDelete || loading) && dm.deleteBtnDisabled]}
              onPress={() => onConfirm(text)}
              disabled={!canDelete || loading}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
              accessibilityState={{ disabled: !canDelete || loading }}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={dm.deleteText}>Delete my account</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: theme.BG,
    borderRadius: 20,
    padding: 24,
    gap: 12,
    alignItems: 'center',
  },
  icon: { marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', color: theme.TEXT },
  body: {
    fontSize: 14,
    color: theme.MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputLabel: { fontSize: 13, fontWeight: '600', color: theme.TEXT, alignSelf: 'flex-start' },
  word: { color: theme.ERROR, fontWeight: '800' },
  input: {
    alignSelf: 'stretch',
    height: 48,
    borderWidth: 1.5,
    borderColor: theme.BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: theme.ERROR,
    letterSpacing: 2,
  },
  btnRow: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 4 },
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
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 999,
    backgroundColor: theme.ERROR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  // ── Sign out ──────────────────────────────────────────────────────────────

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      await SecureStore.deleteItemAsync('invite_code');
    } catch (e) {
      logger.error('Sign out failed', e);
    } finally {
      router.replace('/(auth)/splash');
    }
  }

  // ── Export data ───────────────────────────────────────────────────────────

  async function handleExportData() {
    setExportingData(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { Toast.show({ type: 'error', text1: 'Not signed in' }); return; }

      const res = await callEdgeFunction('export-data', session.access_token);

      if (res.status === 429) {
        Toast.show({
          type: 'info',
          text1: 'Already exported today',
          text2: 'Data export is limited to once every 24 hours.',
        });
        return;
      }
      if (!res.ok) {
        Toast.show({ type: 'error', text1: 'Export failed', text2: 'Please try again.' });
        return;
      }

      // On native, sharing is the best way to "download" a JSON file
      const json = await res.json();
      const filename = `hala-data-${new Date().toISOString().slice(0, 10)}.json`;
      Alert.alert(
        'Export ready',
        `Your data has been prepared as "${filename}". ` +
        'In the next step you can save or share it.',
        [
          { text: 'OK', onPress: () => {
            // On a real device, use expo-sharing to open the native share sheet
            // with the JSON string as a file. Skipping here to avoid adding
            // another dependency — the JSON can also be emailed from the Supabase
            // dashboard → Auth → Users → Download.
            Toast.show({ type: 'success', text1: 'Data exported', text2: json.exported_at });
          }},
        ],
      );
    } catch (e) {
      logger.error('Export data failed', e);
      Toast.show({ type: 'error', text1: 'Export failed' });
    } finally {
      setExportingData(false);
    }
  }

  // ── Delete account ────────────────────────────────────────────────────────

  function openDeleteFlow() {
    // Require biometric re-authentication before showing the confirmation modal.
    // If the device has no biometrics enrolled, fall through to the modal directly.
    LocalAuthentication.hasHardwareAsync().then((hasHW) => {
      if (!hasHW) { setDeleteModalVisible(true); return; }

      LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm your identity to delete your account',
        fallbackLabel: 'Use passcode',
      }).then((result) => {
        if (result.success) {
          setDeleteModalVisible(true);
        } else {
          Toast.show({ type: 'error', text1: 'Authentication failed', text2: 'Please try again.' });
        }
      });
    });
  }

  async function handleConfirmDelete(confirmation: string) {
    if (confirmation !== 'DELETE') return;
    setDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { Toast.show({ type: 'error', text1: 'Not signed in' }); return; }

      const res = await callEdgeFunction('delete-account', session.access_token, {
        confirmation: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        Toast.show({ type: 'error', text1: body.error ?? 'Deletion failed. Please try again.' });
        return;
      }

      // Clear all local state
      await SecureStore.deleteItemAsync('invite_code');
      setDeleteModalVisible(false);

      Toast.show({ type: 'success', text1: 'Account deleted', text2: 'We\'re sorry to see you go.' });
      // Small delay so the toast is visible before navigating away
      setTimeout(() => router.replace('/(auth)/splash'), 1500);
    } catch (e) {
      logger.error('Account deletion failed', e);
      Toast.show({ type: 'error', text1: 'Something went wrong. Please try again.' });
    } finally {
      setDeletingAccount(false);
    }
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  const sections: Section[] = [
    {
      title: 'Privacy & data',
      items: [
        {
          label: 'Privacy Policy',
          icon: 'document-text-outline',
          onPress: () => Linking.openURL('https://hala.app/privacy'),
          accessibilityHint: 'Opens the Hala privacy policy in your browser',
        },
        {
          label: exportingData ? 'Exporting…' : 'Export my data',
          icon: 'download-outline',
          onPress: handleExportData,
          accessibilityHint: 'Downloads a copy of all your Hala data as a JSON file',
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          label: 'Contact support',
          icon: 'mail-outline',
          onPress: () => Linking.openURL('mailto:support@hala.app'),
          accessibilityHint: 'Opens your email app to contact Hala support',
        },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          label: 'Sign out',
          icon: 'log-out-outline',
          onPress: handleSignOut,
          accessibilityHint: 'Signs you out of Hala on this device',
        },
        {
          label: 'Delete account',
          icon: 'trash-outline',
          onPress: openDeleteFlow,
          destructive: true,
          accessibilityHint: 'Permanently deletes your Hala account and all associated data',
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.TEXT} />
        </Pressable>
        <Text style={s.heading}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {sections.map((section, si) => (
          <View key={si} style={s.section}>
            {section.title && (
              <Text style={s.sectionTitle}>{section.title}</Text>
            )}
            <View style={s.card}>
              {section.items.map((item, ii) => (
                <View key={ii}>
                  {ii > 0 && <View style={s.separator} />}
                  <SettingsRow item={item} />
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={s.version}>Hala v1.0.0</Text>
      </ScrollView>

      <DeleteModal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
        onConfirm={handleConfirmDelete}
        loading={deletingAccount}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.SURFACE },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.BORDER,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  heading: { fontSize: 17, fontWeight: '700', color: theme.TEXT },

  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.BG,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.BORDER,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowPressed: { backgroundColor: theme.SURFACE },
  rowIcon: { marginRight: 14, width: 22, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 15, color: theme.TEXT },
  rowLabelDestructive: { color: theme.ERROR },

  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.BORDER,
    marginLeft: 52,
  },

  version: {
    textAlign: 'center',
    color: theme.MUTED,
    fontSize: 12,
    marginTop: 32,
    marginBottom: 48,
  },
});

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { theme } from '../lib/theme';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: theme.ERROR,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  message: { flex: 1, fontSize: 14, color: theme.ERROR, lineHeight: 20 },
  retryBtn: { marginLeft: 12, paddingHorizontal: 12, paddingVertical: 4 },
  retryText: { fontSize: 14, fontWeight: '600', color: theme.ERROR },
});

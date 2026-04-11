import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../lib/theme';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, subtitle, icon }: EmptyStateProps) {
  return (
    <View
      style={styles.container}
      accessibilityLiveRegion="polite"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      {icon && <View style={styles.iconWrap} accessibilityElementsHidden>{icon}</View>}
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  iconWrap: { marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', color: theme.TEXT, textAlign: 'center' },
  subtitle: { fontSize: 14, color: theme.MUTED, textAlign: 'center', lineHeight: 20 },
});

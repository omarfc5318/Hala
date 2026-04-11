import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '../lib/theme';

interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  /** Overrides the default accessibilityLabel ("name's avatar"). Pass '' to hide from screen readers. */
  accessibilityLabel?: string;
}

export function Avatar({ uri, name, size = 44, accessibilityLabel }: AvatarProps) {
  const initials = (name || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;
  const a11yLabel = accessibilityLabel !== undefined
    ? accessibilityLabel
    : `${name}'s avatar`;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        accessibilityLabel={a11yLabel}
        accessibilityRole="image"
      />
    );
  }

  return (
    <View
      style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      <Text style={[styles.initials, { fontSize: size * 0.38 }]} accessibilityElementsHidden>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: theme.PRIMARY_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: theme.PRIMARY,
    fontWeight: '700',
  },
});

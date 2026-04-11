import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../lib/theme';

type City = 'riyadh' | 'dubai';

const CITY_LABELS: Record<City, string> = {
  riyadh: 'Riyadh',
  dubai: 'Dubai',
};

interface CityBadgeProps {
  city: City | null | undefined;
  size?: 'sm' | 'md';
}

export function CityBadge({ city, size = 'sm' }: CityBadgeProps) {
  if (!city) return null;
  const isMd = size === 'md';

  return (
    <View style={[styles.pill, isMd && styles.pillMd]}>
      <Text style={[styles.label, isMd && styles.labelMd]}>{CITY_LABELS[city]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: theme.PRIMARY_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillMd: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.PRIMARY,
  },
  labelMd: {
    fontSize: 13,
  },
});

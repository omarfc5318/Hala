import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '../lib/theme';

const COL_GAP = 12;
const H_PAD = 16;
const CARD_WIDTH = (Dimensions.get('window').width - H_PAD * 2 - COL_GAP) / 2;

export interface EateryCardData {
  id: string;
  name: string;
  photos: string[];
}

interface EateryPhotoCardProps {
  eatery: EateryCardData;
  onPress: () => void;
}

export function EateryPhotoCard({ eatery, onPress }: EateryPhotoCardProps) {
  const photo = eatery.photos?.[0] ?? null;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
      )}

      {/* Name overlay */}
      <View style={styles.overlay}>
        <Text style={styles.name} numberOfLines={2}>{eatery.name}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.SURFACE,
  },
  placeholder: {
    backgroundColor: theme.BORDER,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
    // Gradient-like darkening via semi-transparent bg
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

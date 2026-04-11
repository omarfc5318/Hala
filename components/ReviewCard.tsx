import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '../lib/theme';

export interface ReviewCardData {
  id: string;
  rank: number;
  text: string | null;
  favourite_dish: string | null;
  eatery: {
    id: string;
    name: string;
    photos: string[];
  };
}

interface ReviewCardProps {
  review: ReviewCardData;
  onPress: () => void;
}

export function ReviewCard({ review, onPress }: ReviewCardProps) {
  const photo = review.eatery.photos?.[0] ?? null;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {/* Eatery photo */}
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]} />
      )}

      {/* Content */}
      <View style={styles.body}>
        <Text style={styles.eateryName} numberOfLines={1}>{review.eatery.name}</Text>

        {review.favourite_dish && (
          <View style={styles.dishChip}>
            <Text style={styles.dishText} numberOfLines={1}>{review.favourite_dish}</Text>
          </View>
        )}

        {review.text && (
          <Text style={styles.reviewText} numberOfLines={2}>{review.text}</Text>
        )}
      </View>

      {/* Rank badge */}
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>#{review.rank}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.BG,
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.BORDER,
  },
  photo: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  photoPlaceholder: {
    backgroundColor: theme.SURFACE,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  eateryName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.TEXT,
  },
  dishChip: {
    backgroundColor: theme.PRIMARY_LIGHT,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  dishText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.PRIMARY,
  },
  reviewText: {
    fontSize: 12,
    color: theme.MUTED,
    lineHeight: 16,
  },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.BG,
  },
});

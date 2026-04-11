import { useRef, useEffect } from 'react';
import { View, Animated } from 'react-native';
import { theme } from '../lib/theme';

interface SkeletonCardProps {
  height?: number;
}

export function SkeletonCard({ height = 100 }: SkeletonCardProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        height,
        borderRadius: 12,
        backgroundColor: theme.BORDER,
        marginBottom: 12,
        opacity,
      }}
    />
  );
}

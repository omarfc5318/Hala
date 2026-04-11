// lib/notifications.ts
// Push token registration — call once after the user signs in or signs up.
import * as ExpoNotifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Device from 'expo-device';
import { supabase } from './supabase';
import { logger } from './logger';

// Global notification handler — show alerts + play sound while app is foregrounded
ExpoNotifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request permission and upsert the device's Expo push token to Supabase.
 * Safe to call on every login — UNIQUE(token) prevents duplicates.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    // Physical device required — silently no-op on simulator
    if (!Device.isDevice) return;

    const { status: existing } = await ExpoNotifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await ExpoNotifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const projectId =
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? '';

    const { data: tokenData } = await ExpoNotifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    if (!tokenData) return;

    // Upsert: if the same token re-registers, update user_id (device re-used)
    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        token: tokenData,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
      { onConflict: 'token' },
    );

    if (error) logger.error('push_tokens upsert failed', error);
  } catch (e) {
    logger.error('registerPushToken failed', e);
  }
}

/**
 * Navigate to the right screen when the user taps a push notification.
 * Wire this up in _layout.tsx with addNotificationResponseReceivedListener.
 */
export function resolveNotificationRoute(
  data: Record<string, unknown>,
): string | null {
  const type = data?.type as string | undefined;
  const entityId = data?.entity_id as string | undefined;

  switch (type) {
    case 'friend_request':
    case 'friend_accepted':
      return '/notifications';
    case 'friend_reviewed_eatery':
      return entityId ? `/eatery/${entityId}` : '/notifications';
    default:
      return '/notifications';
  }
}

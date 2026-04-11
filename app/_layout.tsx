import '../global.css';
import { useEffect, useRef } from 'react';
import { Stack, router } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import * as ExpoNotifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { toastConfig } from '../components/ToastConfig';
import { resolveNotificationRoute } from '../lib/notifications';

// ---------------------------------------------------------------------------
// Sentry — initialise before the component tree mounts
// Run `npx sentry-expo-upload-sourcemaps dist` in CI to upload source maps
// ---------------------------------------------------------------------------

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production'),
  // Sample 20% of transactions — keeps quota under control in prod
  tracesSampleRate: 0.2,
  // Strip PII before sending to Sentry
  beforeSend: (event) => {
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
    }
    return event;
  },
  // Suppress in dev so the console stays clean; still captures exceptions
  enabled: !__DEV__,
  integrations: [
    Sentry.reactNativeTracingIntegration(),
  ],
});

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

function RootLayout() {
  const notifResponseSub = useRef<ExpoNotifications.Subscription | null>(null);

  useEffect(() => {
    // Navigate to the correct screen when user taps a push notification
    notifResponseSub.current =
      ExpoNotifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const route = resolveNotificationRoute(data);
        if (route) router.push(route as Parameters<typeof router.push>[0]);
      });

    return () => { notifResponseSub.current?.remove(); };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <Toast config={toastConfig} />
    </GestureHandlerRootView>
  );
}

// Sentry.wrap captures JS errors + React component tree errors at the root
export default Sentry.wrap(RootLayout);

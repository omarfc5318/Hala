// Mock all native / Expo modules that are imported at the top of notifications.ts
// before importing the module under test.

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'test-project-id' } } } },
}));

jest.mock('expo-device', () => ({
  default: { isDevice: false },
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));

// Now import — module-level side effects (setNotificationHandler) will use mocks
import { resolveNotificationRoute } from '../../lib/notifications';

// ---------------------------------------------------------------------------
// resolveNotificationRoute
// ---------------------------------------------------------------------------

describe('resolveNotificationRoute', () => {
  it('routes friend_request to /notifications', () => {
    expect(resolveNotificationRoute({ type: 'friend_request' })).toBe('/notifications');
  });

  it('routes friend_accepted to /notifications', () => {
    expect(resolveNotificationRoute({ type: 'friend_accepted' })).toBe('/notifications');
  });

  it('routes friend_reviewed_eatery with entityId to the eatery screen', () => {
    expect(resolveNotificationRoute({ type: 'friend_reviewed_eatery', entity_id: 'abc-123' }))
      .toBe('/eatery/abc-123');
  });

  it('routes friend_reviewed_eatery without entityId to /notifications', () => {
    expect(resolveNotificationRoute({ type: 'friend_reviewed_eatery' }))
      .toBe('/notifications');
  });

  it('routes unknown type to /notifications', () => {
    expect(resolveNotificationRoute({ type: 'something_else' })).toBe('/notifications');
  });

  it('handles empty data object', () => {
    expect(resolveNotificationRoute({})).toBe('/notifications');
  });
});

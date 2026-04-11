export const theme = {
  PRIMARY: '#7C3AED',
  PRIMARY_LIGHT: '#EDE9FE',
  PRIMARY_DARK: '#5B21B6',
  ACCENT: '#8B5CF6',
  BG: '#FFFFFF',
  SURFACE: '#F9FAFB',
  TEXT: '#1C1C1E',
  MUTED: '#8E8E93',
  BORDER: '#E5E5EA',
  ERROR: '#EF4444',
  SUCCESS: '#10B981',
  CARD_BG: '#F9F9F9',
  TAB_ACTIVE: '#7C3AED',
  TAB_INACTIVE: '#8E8E93',
} as const;

export type ThemeColors = typeof theme;

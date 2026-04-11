import { View, Text, StyleSheet } from 'react-native';
import { BaseToastProps } from 'react-native-toast-message';
import { theme } from '../lib/theme';

function ToastBase({
  text1,
  text2,
  borderColor,
}: BaseToastProps & { borderColor: string }) {
  return (
    <View style={[styles.container, { borderLeftColor: borderColor }]}>
      {text1 && <Text style={styles.title}>{text1}</Text>}
      {text2 && <Text style={styles.body}>{text2}</Text>}
    </View>
  );
}

export const toastConfig = {
  success: (props: BaseToastProps) => (
    <ToastBase {...props} borderColor={theme.SUCCESS} />
  ),
  error: (props: BaseToastProps) => (
    <ToastBase {...props} borderColor={theme.ERROR} />
  ),
  info: (props: BaseToastProps) => (
    <ToastBase {...props} borderColor={theme.PRIMARY} />
  ),
};

const styles = StyleSheet.create({
  container: {
    width: '90%',
    backgroundColor: theme.BG,
    borderRadius: 10,
    borderLeftWidth: 5,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  title: { fontSize: 14, fontWeight: '700', color: theme.TEXT },
  body: { fontSize: 13, color: theme.MUTED, marginTop: 2 },
});

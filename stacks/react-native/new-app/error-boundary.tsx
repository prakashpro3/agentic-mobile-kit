// The app's error boundary. The root layout exports it, so Expo Router shows it, with a way to try again, when a screen
// throws while rendering, instead of a blank screen or a closed app. A route can export its own ErrorBoundary for its
// screens. Once the app has a crash reporter, report the error here.
import { type ErrorBoundaryProps } from 'expo-router';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={[styles.screen, dark && styles.screenDark]} accessibilityLiveRegion="assertive">
      <Text style={[styles.title, dark && styles.textDark]} accessibilityRole="header">
        Something went wrong
      </Text>
      {__DEV__ ? <Text style={[styles.detail, dark && styles.textDark]}>{error.message}</Text> : null}
      <Pressable onPress={retry} style={styles.button} accessibilityRole="button" accessibilityLabel="Try again" testID="error-try-again">
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#fff' },
  screenDark: { backgroundColor: '#000' },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', color: '#000' },
  detail: { fontSize: 14, textAlign: 'center', color: '#000' },
  textDark: { color: '#fff' },
  button: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, backgroundColor: '#007AFF' },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});

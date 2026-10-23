// The app's error boundary. index.js registers withErrorBoundary(App), so a render error anywhere in the app shows this
// screen, with a way to try again, instead of a blank screen or a closed app. Once the app has a crash reporter, report
// the error in componentDidCatch (or use the reporter's own boundary).
import React from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <Fallback error={this.state.error} retry={() => this.setState({ error: null })} />;
  }
}

function Fallback({ error, retry }: { error: Error; retry: () => void }) {
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

// the app's root component inside the boundary
export function withErrorBoundary<P extends object>(Component: React.ComponentType<P>) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
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

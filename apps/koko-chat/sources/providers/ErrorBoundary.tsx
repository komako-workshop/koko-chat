import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Renders caught React errors inline so we don't get a mystery white screen
 * on web. In production we'd want a prettier fallback, but for development
 * visible stacks beat silent failure.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    console.error("[koko] ErrorBoundary caught", error, info);
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    const stack = this.state.error.stack ?? String(this.state.error);
    const componentStack = this.state.info?.componentStack ?? "";
    return (
      <View style={{ flex: 1, backgroundColor: "#fee", padding: 16, paddingTop: 40 }}>
        <ScrollView>
          <Text style={{ fontSize: 20, fontWeight: "bold", color: "#b91c1c", marginBottom: 12 }}>
            🦞 KokoChat crashed
          </Text>
          <Text style={{ fontFamily: "monospace", fontSize: 12, color: "#7f1d1d", marginBottom: 8 }}>
            {this.state.error.name}: {this.state.error.message}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#991b1b", marginTop: 12, marginBottom: 4 }}>
            Stack
          </Text>
          <Text style={{ fontFamily: "monospace", fontSize: 11, color: "#7f1d1d" }}>{stack}</Text>
          {componentStack !== "" ? (
            <>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#991b1b", marginTop: 12, marginBottom: 4 }}>
                Component tree
              </Text>
              <Text style={{ fontFamily: "monospace", fontSize: 11, color: "#7f1d1d" }}>{componentStack}</Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const DEEPLY_INK = "#111111";

/**
 * Deeply 风格的"等 agent 开口"等待动画。视觉对齐 standard chat 的
 * StreamingPulse:一个深色实心核心 + 两个交错的 halo,每隔 800ms 一波
 * 向外扩散并淡出,看起来像 IM 里"对方正在输入"的呼吸感。
 *
 * 用在 `streaming === true && text === ""` 的瞬态 —— 用户已经发问、
 * agent run 已经开始,但第一段文字还没流到本地。一旦文字开始流,
 * 调用方应当切换到 BlinkingCursor(细光标)。
 *
 * 实现细节:
 * - 双 halo 错开 800ms,保证任意时刻都有一个 ring 在扩散,
 *   不会出现"死帧"那种节奏断裂感。
 * - opacity 动画走 useNativeDriver,跑在 UI 线程,JS 线程被
 *   streaming token 处理打满时也不会掉帧。
 */
export function DeeplyPulse(): React.ReactElement {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (value: Animated.Value): Animated.CompositeAnimation =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true
          })
        ])
      );

    const loop1 = makeLoop(ring1);
    loop1.start();

    // 第二条 halo 延后 800ms 启动,跟第一条交错出现,任何时刻
    // 都有一个 ring 在向外扩。loop 句柄存在 holder 里,cleanup
    // 不用重新计算作用域。
    const loop2Holder: { current?: Animated.CompositeAnimation } = {};
    const offsetTimer = setTimeout(() => {
      const loop2 = makeLoop(ring2);
      loop2.start();
      loop2Holder.current = loop2;
    }, 800);

    return () => {
      loop1.stop();
      clearTimeout(offsetTimer);
      loop2Holder.current?.stop();
    };
  }, [ring1, ring2]);

  const haloStyle = (value: Animated.Value) => ({
    transform: [
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.55, 1.9]
        })
      }
    ],
    opacity: value.interpolate({
      inputRange: [0, 0.85, 1],
      outputRange: [0.4, 0, 0]
    })
  });

  return (
    <View
      style={styles.pulse}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="正在思考"
    >
      <Animated.View style={[styles.halo, haloStyle(ring1)]} />
      <Animated.View style={[styles.halo, haloStyle(ring2)]} />
      <View style={styles.core} />
    </View>
  );
}

/**
 * Streaming 文字末尾的小光标,~1100ms 一次 opacity 1 → 0.12 → 1 呼吸。
 * 跟 IM 输入光标同款,但 easing 偏柔,不刺眼。
 *
 * 用在 `streaming === true && text.length > 0` —— 文字已经开始流,
 * 给末尾加一个会动的标记,确认 agent 还在写。等待开口阶段请用 DeeplyPulse。
 */
export function BlinkingCursor(): React.ReactElement {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.12,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.Text style={[styles.cursor, { opacity }]} accessibilityElementsHidden>
      {" ▍"}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  pulse: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  halo: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: DEEPLY_INK
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DEEPLY_INK
  },
  cursor: {
    color: "#6B6B66"
  }
});

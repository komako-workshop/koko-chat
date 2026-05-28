import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useAndroidKeyboardSpacerHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") {
      setHeight(0);
      return;
    }

    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setHeight(Math.max(0, event.endCoordinates.height));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setHeight(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return Platform.OS === "android" ? height : 0;
}

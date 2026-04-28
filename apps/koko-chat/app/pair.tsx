import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

export default function PairScreen() {
  return (
    <SafeAreaView style={tw`flex-1 bg-slate-50 dark:bg-slate-950`}>
      <View style={tw`flex-1 justify-center px-8 py-12`}>
        <Text style={tw`text-3xl font-bold text-slate-950 dark:text-slate-50`}>Pair with koko-cli</Text>
        <Text style={tw`mt-4 text-base leading-6 text-slate-600 dark:text-slate-300`}>
          QR scanner & flow coming in Task 04b.
        </Text>

        <Link href="/" asChild>
          <Pressable
            accessibilityRole="button"
            style={tw`mt-10 items-center rounded-2xl bg-slate-950 px-6 py-4 dark:bg-slate-100`}
          >
            <Text style={tw`text-base font-semibold text-white dark:text-slate-950`}>Back Home</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

import { SensorLoggerProvider } from "@/context/SensorLoggerContext";
import { auth } from "@/firebaseConfig";
import { Orbitron_400Regular, useFonts } from "@expo-google-fonts/orbitron";
import { Stack, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged, User } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import "./global.css";

export default function RootLayout() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const segments = useSegments();
  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
  });

  // 1. Listen for authentication state
  useEffect(() => {
    const subscriber = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (initializing) setInitializing(false);
    });
    return subscriber; // unsubscribe on unmount
  }, []);

  // 2. Protect the route
  useEffect(() => {
    if (initializing) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!user && !inAuthGroup) {
      // Not logged in + trying to access app -> Redirect to Login
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      // Logged in + currently on Login page -> Redirect to Tabs
      router.replace("/(tabs)");
    }
  }, [user, initializing, segments]);

  // 3. Show loading screen while checking auth
  // do this BEFORE rendering the SensorProvider so sensors don't start
  // until we know who the user is.
  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#00a8c6ff" />
      </View>
    );
  }

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // 4. Render App
  return (
    <SensorLoggerProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Main App (Protected) */}
        <Stack.Screen name="(tabs)" />

        {/* Auth Screens (Public) */}
        <Stack.Screen name="(auth)" />
      </Stack>
    </SensorLoggerProvider>
  );
}

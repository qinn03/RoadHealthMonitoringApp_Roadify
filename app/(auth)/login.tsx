import { auth } from "@/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Listener in _layout will handle redirection
    } catch (error: any) {
      Alert.alert("Login Failed", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.contentContainer}>
        <View style={styles.headerContainer}>
          <Ionicons name="car-sport" size={60} color="#00a8c6ff" />
          <Text style={styles.appName}>Roadify.</Text>
          <Text style={styles.title}>Welcome Back!</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        {/* Email Input Field container */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="mail-outline"
            size={20}
            color="#9CA3AF"
            style={styles.inputIcon}
          />
          <TextInput
            placeholder="Email"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        {/* Password Input Field container */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={20}
            color="#9CA3AF"
            style={styles.inputIcon}
          />
          <TextInput
            placeholder="Password"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {/* Forgot Password Link */}
        <TouchableOpacity style={styles.forgotPasswordButton}>
          <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/register")}>
            <Text style={styles.linkText}>Register</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  contentContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 30,
  },

  appName: {
    fontSize: 36,
    color: "#00a8c6ff",
    marginBottom: 15,
    letterSpacing: 1,
    fontFamily: "Orbitron_400Regular",
    textAlign: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1F2937",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#6B7280",
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    height: 56,
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: "100%",
    fontSize: 16,
    color: "#1F2937",
  },
  forgotPasswordButton: {
    alignSelf: "flex-end",
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: "#00a8c6ff",
    fontSize: 13,
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#00a8c6ff",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#00a8c6ff",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  footerContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    fontSize: 15,
    color: "#6B7280",
  },
  linkText: {
    color: "#00a8c6ff",
    fontSize: 15,
    fontWeight: "700",
  },
});

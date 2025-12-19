import { auth, db } from "@/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !fullName) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      await updateProfile(user, { displayName: fullName });
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        displayName: fullName,
        email: email,
        createdAt: new Date(),
        role: "user",
      });

      Alert.alert("Success", "Account created! Welcome to Roadify 👋");
    } catch (error: any) {
      Alert.alert("Registration Failed", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerContainer}>
          <Text style={styles.appName}>Welcome to Roadify!</Text>
          <Ionicons
            name="person-add-outline"
            size={60}
            color="#00a8c6ff"
            style={styles.logo}
          />
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join us and get started today</Text>
        </View>

        <View style={styles.inputContainer}>
          <Ionicons
            name="person-outline"
            size={20}
            color="#9CA3AF"
            style={styles.inputIcon}
          />
          <TextInput
            placeholder="Full Name"
            placeholderTextColor="#9CA3AF"
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
          />
        </View>

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

        <View style={{ height: 24 }} />

        <TouchableOpacity
          style={styles.button}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
            <Text style={styles.linkText}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 30,
    marginTop: 25,
  },
  logo: {
    marginBottom: 10,
  },
  appName: {
    fontSize: 34,
    color: "#00a8c6ff",
    marginBottom: 20,
    letterSpacing: 1,
    fontFamily: "Orbitron_400Regular",
    textAlign: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1F2937",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
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
    marginBottom: 20,
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

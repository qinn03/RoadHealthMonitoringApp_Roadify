import { auth, db, storage } from "@/firebaseConfig";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  EmailAuthProvider,
  User,
  deleteUser as firebaseDeleteUser,
  signOut as firebaseSignOut,
  updateEmail as firebaseUpdateEmail,
  updatePassword as firebaseUpdatePassword,
  reauthenticateWithCredential,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type UserDoc = {
  displayName?: string;
  email?: string;
  phone?: string;
  photoURL?: string;
  notificationsEnabled?: boolean;
  updatedAt?: any;
};

type EditModalState = {
  key: "displayName" | "email" | "phone" | "password" | null;
  visible: boolean;
  value: string;
};

export default function ProfileScreen() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(
    auth.currentUser
  );
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [editModal, setEditModal] = useState<EditModalState>({
    key: null,
    visible: false,
    value: "",
  });
  const [passwordConfirm, setPasswordConfirm] = useState<string>("");
  const [updating, setUpdating] = useState<boolean>(false);

  // Subscribe to auth changes
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      setFirebaseUser(u);
    });
    return () => unsubAuth();
  }, []);

  // Subscribe to user doc in Firestore
  useEffect(() => {
    if (!firebaseUser) {
      setUserDoc(null);
      setLoading(false);
      return;
    }

    const userRef = doc(db, "users", firebaseUser.uid);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          setUserDoc(snap.data() as UserDoc);
        } else {
          // create a doc using Auth info if missing
          const initial: UserDoc = {
            displayName: firebaseUser.displayName ?? "User",
            email: firebaseUser.email ?? "",
            phone: "",
            photoURL: firebaseUser.photoURL ?? "",
            notificationsEnabled: true,
            updatedAt: serverTimestamp(),
          };
          setDoc(userRef, initial, { merge: true }).catch(console.warn);
          setUserDoc(initial);
        }
        setLoading(false);
      },
      (err) => {
        console.warn("user doc snapshot error", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [firebaseUser]);

  // --- Handle Image Selection & Upload ---
  const handlePickAvatar = async () => {
    if (!firebaseUser) return;

    // 1. Request Permission
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert("Permission to access camera roll is required!");
      return;
    }

    // 2. Pick Image
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1], // Square crop for avatars
      quality: 0.5, // Compress slightly
    });

    if (pickerResult.canceled) {
      return;
    }

    const localUri = pickerResult.assets[0].uri;
    uploadAvatar(localUri);
  };

  const uploadAvatar = async (uri: string) => {
    if (!firebaseUser) return;
    setUploadingImage(true);

    try {
      // 1. Fetch blob from local URI
      const response = await fetch(uri);
      const blob = await response.blob();

      // 2. Create reference (users/{uid}/avatar.jpg)
      const filename = "avatar.jpg";
      const storageRef = ref(storage, `users/${firebaseUser.uid}/${filename}`);

      // 3. Upload
      await uploadBytes(storageRef, blob);

      // 4. Get Download URL
      const downloadURL = await getDownloadURL(storageRef);

      // 5. Update Profile (Auth + Firestore)
      await updateProfile(firebaseUser, { photoURL: downloadURL });
      const userRef = doc(db, "users", firebaseUser.uid);
      await updateDoc(userRef, {
        photoURL: downloadURL,
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Success", "Your profile picture is updated!");
    } catch (e: any) {
      console.error("Upload failed", e);
      Alert.alert("Upload failed", e.message || "Could not upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  // Helpers to open/close edit modal
  const openEdit = (key: EditModalState["key"]) => {
    if (!firebaseUser && key !== "password") {
      Alert.alert("Not signed in");
      return;
    }
    let initial = "";
    if (key === "displayName")
      initial = firebaseUser?.displayName ?? userDoc?.displayName ?? "";
    if (key === "email") initial = firebaseUser?.email ?? userDoc?.email ?? "";
    if (key === "phone") initial = userDoc?.phone ?? "";
    if (key === "password") initial = "";
    setEditModal({ key, visible: true, value: initial });
  };

  const closeEdit = () =>
    setEditModal({ key: null, visible: false, value: "" });

  // Generic update handler for displayName / phone / email
  const onSaveEdit = async () => {
    if (!editModal.key) return;
    setUpdating(true);
    try {
      if (editModal.key === "displayName") {
        if (firebaseUser) {
          await updateProfile(firebaseUser, { displayName: editModal.value });
          const userRef = doc(db, "users", firebaseUser.uid);
          await updateDoc(userRef, {
            displayName: editModal.value,
            updatedAt: serverTimestamp(),
          });
        }
      } else if (editModal.key === "phone") {
        if (!firebaseUser) throw new Error("Not authenticated");
        const userRef = doc(db, "users", firebaseUser.uid);
        await updateDoc(userRef, {
          phone: editModal.value,
          updatedAt: serverTimestamp(),
        });
      } else if (editModal.key === "email") {
        if (!firebaseUser) throw new Error("Not authenticated");
        try {
          await firebaseUpdateEmail(firebaseUser, editModal.value);
        } catch (e: any) {
          if (e.code === "auth/requires-recent-login") {
            Alert.alert(
              "Reauthentication required",
              "Please re-enter your password to confirm your identity and update email.",
              [{ text: "OK" }]
            );
            setEditModal({ key: "password", visible: true, value: "" });
            setUpdating(false);
            return;
          }
          throw e;
        }
        const userRef = doc(db, "users", firebaseUser.uid);
        await updateDoc(userRef, {
          email: editModal.value,
          updatedAt: serverTimestamp(),
        });
      }
      closeEdit();
    } catch (err: any) {
      console.warn(err);
      Alert.alert("Update failed", err.message ?? String(err));
    } finally {
      setUpdating(false);
    }
  };

  const onSavePasswordFlow = async () => {
    if (!firebaseUser) {
      Alert.alert("Not signed in");
      return;
    }
    setUpdating(true);
    try {
      if (!passwordConfirm) {
        Alert.alert("Please enter your current password to continue.");
        setUpdating(false);
        return;
      }
      const cred = EmailAuthProvider.credential(
        firebaseUser.email || "",
        passwordConfirm
      );
      await reauthenticateWithCredential(firebaseUser, cred);

      if (editModal.key === "password" && editModal.value) {
        await firebaseUpdatePassword(firebaseUser, editModal.value);
        Alert.alert("Password updated");
        closeEdit();
        setPasswordConfirm("");
      } else if (editModal.key === null || editModal.key === "password") {
        Alert.alert(
          "Reauthentication successful",
          "Please reopen the email change flow now."
        );
        closeEdit();
        setPasswordConfirm("");
      }
    } catch (e: any) {
      console.warn("reauth error", e);
      Alert.alert(
        "Authentication failed",
        e.message ?? "Failed to reauthenticate. Try logging in again."
      );
    } finally {
      setUpdating(false);
    }
  };

  const toggleNotifications = async (value: boolean) => {
    if (!firebaseUser) {
      Alert.alert("Not signed in");
      return;
    }
    try {
      const userRef = doc(db, "users", firebaseUser.uid);
      await updateDoc(userRef, {
        notificationsEnabled: value,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn(e);
      Alert.alert("Failed to update notifications");
    }
  };

  const onLogout = async () => {
    Alert.alert("Log out", "Do you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          try {
            await firebaseSignOut(auth);
          } catch (e) {
            console.warn(e);
            Alert.alert("Logout failed");
          }
        },
      },
    ]);
  };

  const onDeleteAccount = async () => {
    if (!firebaseUser) {
      Alert.alert("Not signed in");
      return;
    }
    Alert.alert(
      "Delete account",
      "This action is irreversible. Your Firestore user doc and Auth account will be removed. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await firebaseDeleteUser(firebaseUser);
            } catch (e: any) {
              console.warn("delete error", e);
              if (e.code === "auth/requires-recent-login") {
                Alert.alert(
                  "Reauthentication required",
                  "For security reasons, please sign in again (or re-enter your password) before deleting your account."
                );
              } else {
                Alert.alert(
                  "Delete failed",
                  e.message ?? "Failed to delete account."
                );
              }
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerFull}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const displayName =
    firebaseUser?.displayName ?? userDoc?.displayName ?? "Your Name";
  const email = firebaseUser?.email ?? userDoc?.email ?? "no-email";
  const phone = userDoc?.phone ?? "";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSpace} />

        <View style={styles.avatarWrap}>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={handlePickAvatar}
            disabled={uploadingImage}
          >
            {uploadingImage ? (
              <ActivityIndicator color="#555" />
            ) : userDoc?.photoURL ? (
              <Image
                source={{ uri: userDoc.photoURL }}
                style={styles.avatarImage}
              />
            ) : (
              <Feather name="image" size={48} color="#777" />
            )}

            {/* Camera Overlay Icon */}
            {!uploadingImage && (
              <View style={styles.cameraIconOverlay}>
                <Ionicons name="camera" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.nameText}>{displayName}</Text>
          <TouchableOpacity
            onPress={() => openEdit("displayName")}
            style={styles.editIcon}
          >
            <Feather name="edit-2" size={20} color="#333" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Profile</Text>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => openEdit("email")}
            activeOpacity={0.7}
          >
            <Text style={styles.rowText}>{email}</Text>
            <Feather name="edit" size={22} color="#444" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.row}
            onPress={() => openEdit("phone")}
            activeOpacity={0.7}
          >
            <Text style={styles.rowText}>{phone || "+60..."}</Text>
            <Feather name="edit" size={22} color="#444" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Settings</Text>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.iconRow}
            onPress={() => openEdit("password")}
            activeOpacity={0.7}
          >
            <View style={styles.iconLeft}>
              <Ionicons name="settings-outline" size={22} color="#333" />
            </View>
            <Text style={styles.rowText}>Change Password</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <View style={styles.iconRow}>
            <View style={styles.iconLeft}>
              <MaterialCommunityIcons
                name="bell-outline"
                size={22}
                color="#333"
              />
            </View>
            <Text style={[styles.rowText, { flex: 1 }]}>
              Enable Notifications
            </Text>
            <Switch
              value={!!userDoc?.notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ false: "#ddd", true: "#8ef" }}
              thumbColor={
                Platform.OS === "android"
                  ? userDoc?.notificationsEnabled
                    ? "#06d6a0"
                    : "#fff"
                  : undefined
              }
            />
          </View>
        </View>

        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.row, { justifyContent: "center" }]}
            onPress={onLogout}
            activeOpacity={0.7}
          >
            <Text style={[styles.rowText, { fontSize: 18 }]}>Log Out</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={[
              styles.row,
              { justifyContent: "center", paddingVertical: 18 },
            ]}
            onPress={onDeleteAccount}
            activeOpacity={0.7}
          >
            <Text style={[styles.deleteText]}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Edit Modal */}
      <Modal visible={editModal.visible} animationType="slide" transparent>
        <View style={modalStyles.modalOverlay}>
          <View style={modalStyles.modalCard}>
            <Text style={modalStyles.modalTitle}>
              {editModal.key === "displayName" && "Edit name"}
              {editModal.key === "email" && "Edit email"}
              {editModal.key === "phone" && "Edit phone"}
              {editModal.key === "password" && "Change password"}
            </Text>

            {editModal.key !== "password" ? (
              <>
                <TextInput
                  value={editModal.value}
                  onChangeText={(t) =>
                    setEditModal((s) => ({ ...s, value: t }))
                  }
                  placeholder={
                    editModal.key === "phone"
                      ? "+60 10 ..."
                      : editModal.key === "email"
                        ? "you@example.com"
                        : "Your name"
                  }
                  keyboardType={
                    editModal.key === "phone"
                      ? "phone-pad"
                      : editModal.key === "email"
                        ? "email-address"
                        : "default"
                  }
                  style={modalStyles.input}
                />
                <View style={modalStyles.row}>
                  <TouchableOpacity style={modalStyles.btn} onPress={closeEdit}>
                    <Text style={modalStyles.btnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[modalStyles.btn, modalStyles.btnPrimary]}
                    onPress={onSaveEdit}
                  >
                    {updating ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={[modalStyles.btnText, { color: "#fff" }]}>
                        Save
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={{ marginBottom: 6, color: "#444" }}>
                  Current password (for verification)
                </Text>
                <TextInput
                  value={passwordConfirm}
                  onChangeText={setPasswordConfirm}
                  placeholder="Current password"
                  secureTextEntry
                  style={modalStyles.input}
                />
                <Text style={{ marginTop: 8, marginBottom: 6, color: "#444" }}>
                  New password
                </Text>
                <TextInput
                  value={editModal.value}
                  onChangeText={(t) =>
                    setEditModal((s) => ({ ...s, value: t }))
                  }
                  placeholder="New password (min 6 chars)"
                  secureTextEntry
                  style={modalStyles.input}
                />

                <View style={modalStyles.row}>
                  <TouchableOpacity
                    style={modalStyles.btn}
                    onPress={() => {
                      setPasswordConfirm("");
                      closeEdit();
                    }}
                  >
                    <Text style={modalStyles.btnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[modalStyles.btn, modalStyles.btnPrimary]}
                    onPress={onSavePasswordFlow}
                    disabled={updating}
                  >
                    {updating ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={[modalStyles.btnText, { color: "#fff" }]}>
                        Update
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f7f7" },
  container: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  headerSpace: { height: 6 },
  avatarWrap: {
    marginTop: 6,
    marginBottom: 12,
    alignItems: "center",
    width: "100%",
  },
  avatarCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "#e6e6e6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative", // Added for overlay
  },
  avatarImage: { width: 132, height: 132, resizeMode: "cover" },
  cameraIconOverlay: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: 40,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    paddingTop: 4,
  },
  nameRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  nameText: { fontSize: 28, fontWeight: "700", color: "#111", marginRight: 8 },
  editIcon: { padding: 6 },
  sectionTitle: {
    alignSelf: "flex-start",
    fontSize: 20,
    marginTop: 18,
    marginBottom: 10,
    color: "#111",
    fontWeight: "500",
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 6,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 18,
    justifyContent: "space-between",
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  iconLeft: {
    width: 36,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  rowText: { fontSize: 18, color: "#333" },
  divider: { height: 1, backgroundColor: "#eee", marginHorizontal: 12 },
  deleteText: { color: "#d32f2f", fontSize: 16, fontWeight: "600" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
    backgroundColor: "#0f0f0f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },
  bottomBtn: { alignItems: "center", justifyContent: "center", width: 64 },
  bottomLabel: { color: "#bfbfbf", fontSize: 12, marginTop: 2 },
  fabWrap: { alignItems: "center", width: 90, marginTop: -36 },
  fabButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#8ef6f6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabLabel: { color: "#fff", marginTop: 6, fontSize: 12, textAlign: "center" },
  centerFull: { flex: 1, alignItems: "center", justifyContent: "center" },
});

const modalStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    marginBottom: 12,
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  btnPrimary: { backgroundColor: "#007aff" },
  btnText: { color: "#007aff" },
});

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const PREDICT_URL = process.env.EXPO_PUBLIC_PREDICT_URL || "";

if (!PREDICT_URL) {
  console.warn("WARNING: EXPO_PUBLIC_PREDICT_URL is missing in .env file");
}

// --- HELPERS ---

function imagesMediaType() {
  const anyIP = ImagePicker as any;
  if (anyIP.MediaType?.Images) return [anyIP.MediaType.Images];
  return ImagePicker.MediaTypeOptions.Images;
}

function toPlaceString(r?: Location.LocationGeocodedAddress | null) {
  if (!r) return "";
  const parts = [
    r.name || r.street || r.streetNumber,
    r.district || r.city || r.subregion,
    r.region,
    r.isoCountryCode ? r.isoCountryCode.toUpperCase() : r.country,
  ].filter(Boolean) as string[];
  return parts.join(", ");
}

type PickedAsset = {
  uri: string;
  base64?: string | null;
  fileName?: string | null; // Android
  filename?: string | null; // iOS / web
};

async function prepareUploadFile(asset: PickedAsset) {
  const originalName =
    asset.fileName || asset.filename || asset.uri.split("/").pop() || "";

  let name = originalName.toLowerCase();
  const extMatch = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(name);
  let ext = extMatch?.[1];

  if (!ext || !["jpg", "jpeg", "png", "heic", "heif"].includes(ext)) {
    ext = "jpg";
  }
  if (ext === "heic" || ext === "heif") ext = "jpg";
  const mime = ext === "png" ? "image/png" : "image/jpeg";

  if (!name || !name.includes(".")) {
    name = `upload.${ext}`;
  } else {
    name = name.replace(/\.[a-z0-9]+(?:\?.*)?$/i, `.${ext}`);
  }

  const needsTemp = !asset.uri.startsWith("file://") || !extMatch;
  if (needsTemp && asset.base64) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const file = new File(Paths.cache, `upload-${id}.${ext}`);
    file.write(asset.base64, { encoding: "base64" });
    return { uri: file.uri, name, type: mime } as const;
  }

  return { uri: asset.uri, name, type: mime } as const;
}

async function classifyDefectFromFile(asset: PickedAsset) {
  const file = await prepareUploadFile(asset);

  const form = new FormData();
  form.append("image_file", file as any);

  console.log("POST", PREDICT_URL, { name: file.name, type: file.type });
  const resp = await fetch(PREDICT_URL, { method: "POST", body: form });
  const raw = await resp.text();

  if (!resp.ok) {
    console.log("predict FAIL", resp.status, raw.slice(0, 300));
    throw new Error(`API ${resp.status}: ${raw.slice(0, 400)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
  }

  console.log("predict OK", data);

  let prediction = "Unknown";
  let confidence = 0;
  let boxes: any[] = [];

  if (Array.isArray(data.detections) && data.detections.length) {
    const sorted = [...data.detections].sort(
      (a, b) => (b?.confidence ?? 0) - (a?.confidence ?? 0)
    );
    const top = sorted[0];
    prediction = top?.class_name ?? top?.class ?? "Unknown";
    confidence =
      typeof top?.confidence === "number"
        ? top.confidence
        : Number(top?.confidence ?? 0);

    boxes = sorted
      .map((d) => {
        const b = d?.bbox;
        if (!Array.isArray(b) || b.length < 4) return null;
        const [x1, y1, x2, y2] = b;
        return {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          label: d?.class_name ?? d?.class,
          score: d?.confidence,
        };
      })
      .filter(Boolean);
  } else if (Array.isArray(data.boxes)) {
    boxes = data.boxes;
  }

  return { prediction, confidence, boxes, mime: file.type };
}

// --- MAIN COMPONENT ---

export default function ReportMain() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<
    "idle" | "locating" | "uploading" | "analyzing"
  >("idle");

  useFocusEffect(
    React.useCallback(() => {
      setLoading(false);
      setStep("idle");
    }, [])
  );

  const handleSelectImage = async (fromCamera: boolean) => {
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert("Permission Denied", "Camera or gallery access is required.");
      return;
    }
    if (fromCamera) {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        Alert.alert("Permission Denied", "Camera access is required.");
        return;
      }
    }

    const pickerOpts: any = {
      mediaTypes: imagesMediaType(),
      quality: 0.9,
      base64: true,
    };

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(pickerOpts)
      : await ImagePicker.launchImageLibraryAsync(pickerOpts);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];

    setLoading(true);
    setStep("locating");

    let latStr = "";
    let lngStr = "";
    let place = "";
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latStr = String(pos.coords.latitude);
        lngStr = String(pos.coords.longitude);
        try {
          const r = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          place = toPlaceString(r?.[0]);
        } catch {}
      }
    } catch {}

    try {
      setStep("uploading");
      const api = await classifyDefectFromFile({
        uri: asset.uri,
        base64: asset.base64,
        fileName: (asset as any).fileName,
        filename: (asset as any).filename,
      });
      const dataUri = asset.base64
        ? `data:${api.mime};base64,${asset.base64}`
        : "";

      setStep("analyzing");
      setLoading(false);
      setStep("idle");

      router.push({
        pathname: "/result",
        params: {
          uri: asset.uri,
          dataUri,
          prediction: api.prediction,
          confidence: String(api.confidence),
          boxes: JSON.stringify(api.boxes || []),
          lat: latStr,
          lng: lngStr,
          place,
        },
      });
    } catch (err: any) {
      Alert.alert(
        "Detection failed",
        err?.message ?? "Unable to classify this image."
      );
      const mime = (asset.uri.endsWith(".png") && "image/png") || "image/jpeg";
      const dataUri = asset.base64 ? `data:${mime};base64,${asset.base64}` : "";
      setLoading(false);
      setStep("idle");
      router.push({
        pathname: "/result",
        params: {
          uri: asset.uri,
          dataUri,
          prediction: "Unknown",
          confidence: "0",
          boxes: "[]",
          lat: latStr,
          lng: lngStr,
          place,
        },
      });
    } finally {
      setLoading(false);
      setStep("idle");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header Section */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report a Road Defect</Text>
          <Text style={styles.headerSubtitle}>
            Help us maintain safer roads by reporting road defects you find.
          </Text>
        </View>

        {/* Content Section - Buttons */}
        <View style={styles.content}>
          {/* Camera Button */}
          <TouchableOpacity
            style={styles.cardButton}
            onPress={() => {
              if (loading) return;
              handleSelectImage(true);
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#EEF2FF" }]}>
              <Ionicons name="camera" size={32} color="#4F46E5" />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Take a Photo</Text>
              <Text style={styles.cardDescription}>
                Use your camera to capture a new defect on the spot.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#CBD5E1" />
          </TouchableOpacity>

          {/* Gallery Button */}
          <TouchableOpacity
            style={styles.cardButton}
            onPress={() => {
              if (loading) return;
              handleSelectImage(false);
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.iconCircle, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="images" size={32} color="#16A34A" />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Upload from Gallery</Text>
              <Text style={styles.cardDescription}>
                Select an existing photo from your device's gallery.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#CBD5E1" />
          </TouchableOpacity>
        </View>

        {/* Loading Overlay */}
        {loading && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#4F46E5" />
              <Text style={styles.loadingTitle}>Processing photo...</Text>
              <Text style={styles.loadingSub}>
                {step === "locating" && "Getting your location..."}
                {step === "uploading" && "Uploading image to detector..."}
                {step === "analyzing" && "Analyzing road defect..."}
              </Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    top: 40,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    marginTop: 20,
    marginBottom: 30,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#1E293B",
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#62748eff",
    lineHeight: 20,
  },
  content: {
    gap: 20,
  },
  cardButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 20,
    // Shadow for iOS
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    // Shadow for Android
    elevation: 3,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  cardTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: "#94A3B8",
    lineHeight: 20,
  },
  // Loading Styles
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.8)", // Frosted glass effect
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  loadingCard: {
    width: 280,
    padding: 24,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  loadingTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: "700",
    color: "#1E293B",
  },
  loadingSub: {
    marginTop: 8,
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
  },
});

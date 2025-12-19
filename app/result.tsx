import { db, storage } from "@/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import MapboxGL from "@rnmapbox/maps";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

// --- CONFIG ---
const extra = Constants.expoConfig?.extra || {};
const GOOGLE_API_KEY: string = extra.GOOGLE_API_KEY || "";
const MAPBOX_ACCESS_TOKEN = extra.MAPBOX_ACCESS_TOKEN || "";

// Mapbox token (optional)
try {
  MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
} catch (e) {
  /* ignore */
}

// --- Helpers ---
function firstStr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return undefined;
}
function pctFromScore(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}
function capitalize(str: string) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}
const makeSessionToken = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// --- Types ---
type ImageMetadata = {
  prediction: string;
  confidence: string;
  description: string;
  place: string;
  lat?: string;
  lng?: string;
  allDefects?: string;
};
type PredictionSummary = { label: string; score: number };
type SearchResult = {
  place_id: string;
  description: string;
  structured_formatting?: any;
};

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const insets = useSafeAreaInsets();

  const uri = firstStr(params.uri);
  const dataUri = firstStr(params.dataUri);
  const placeParam = firstStr(params.place) ?? "";
  const boxesRaw = firstStr(params.boxes);
  const latParam = firstStr(params.lat);
  const lngParam = firstStr(params.lng);

  // --- STATE ---
  const [editablePlace, setEditablePlace] = useState(
    placeParam && placeParam.trim().length > 0 ? placeParam : ""
  );
  const [coords, setCoords] = useState({
    lat: latParam ? Number(latParam) : 0,
    lng: lngParam ? Number(lngParam) : 0,
  });

  // map/search
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
  const [pickerCenter, setPickerCenter] = useState(coords);
  const cameraRef = useRef<any>(null); // Mapbox Camera ref
  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null
  );

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<any>(null);
  const searchSessionTokenRef = useRef<string | null>(null);

  // camera lock to avoid jumping and race conditions
  // cameraLockRef holds timestamp until which camera moves are ignored
  const cameraLockRef = useRef<number>(0);
  // cameraReadyRef indicates camera mounted
  const cameraReadyRef = useRef<boolean>(false);

  const hasManuallySetLocation = useRef(false); // check if user has manually altered the location
  const selectedPlaceNameRef = useRef<string | null>(null);

  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const imageSource = useMemo(() => {
    if (dataUri && dataUri.length > 0) return { uri: dataUri };
    if (uri && uri.length > 0) return { uri };
    return undefined;
  }, [uri, dataUri]);

  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const parsedBoxes = useMemo(() => {
    try {
      if (!boxesRaw) return [];
      const arr = JSON.parse(boxesRaw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }, [boxesRaw]);

  const defectSummary: PredictionSummary[] = useMemo(() => {
    const map = new Map<string, number>();
    parsedBoxes.forEach((box: any) => {
      const labelRaw = box.label || box.class_name || box.class || "unknown";
      const scoreRaw = box.score ?? box.confidence ?? 0;
      const label = String(labelRaw).toLowerCase();
      const score = Number(scoreRaw);
      if (!map.has(label) || score > (map.get(label) || 0))
        map.set(label, score);
    });
    return Array.from(map.entries())
      .map(([label, score]) => ({ label, score }))
      .sort((a, b) => b.score - a.score);
  }, [parsedBoxes]);

  const hasDefects = defectSummary.length > 0;
  const primaryPrediction = defectSummary[0]?.label ?? "Unknown";
  const primaryConfidence = defectSummary[0]?.score ?? 0;

  const scaledBoxes = useMemo(() => {
    if (!nat || !frame.w || !frame.h) return [];
    const scale = Math.min(frame.w / nat.w, frame.h / nat.h);
    const drawW = nat.w * scale,
      drawH = nat.h * scale;
    const offsetX = (frame.w - drawW) / 2,
      offsetY = (frame.h - drawH) / 2;
    return parsedBoxes.map((b: any) => {
      let bx = 0,
        by = 0,
        bw = 0,
        bh = 0,
        label = "",
        score = 0;
      if (Array.isArray(b?.bbox)) {
        bx = b.bbox[0];
        by = b.bbox[1];
        bw = b.bbox[2] - b.bbox[0];
        bh = b.bbox[3] - b.bbox[1];
        label = b.class_name ?? b.class;
        score = b.confidence;
      } else {
        bx = b.x;
        by = b.y;
        bw = b.width;
        bh = b.height;
        label = b.label;
        score = b.score;
        if (bx <= 1 && bw <= 1 && nat) {
          bx *= nat.w;
          by *= nat.h;
          bw *= nat.w;
          bh *= nat.h;
        }
      }
      return {
        left: offsetX + bx * scale,
        top: offsetY + by * scale,
        width: bw * scale,
        height: bh * scale,
        label,
        score,
      };
    });
  }, [parsedBoxes, nat, frame]);

  // --- INITIAL LOCATION LOAD ---
  useEffect(() => {
    let mounted = true;
    const initLocation = async () => {
      try {
        // ... permission checks ...
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        const loc = await Location.getCurrentPositionAsync({});
        if (!mounted) return;

        const userLng = loc.coords.longitude;
        const userLat = loc.coords.latitude;

        setUserLocation([userLng, userLat]);

        // ONLY update coords if the user hasn't already picked one manually
        if (!hasManuallySetLocation.current) {
          // <--- ADD CHECK
          if (!latParam && !lngParam) {
            setCoords({ lat: userLat, lng: userLng });
            setPickerCenter({ lat: userLat, lng: userLng });
          }
        }

        // Always update picker center if we are just initializing
        if (coords.lat === 0 && coords.lng === 0) {
          setPickerCenter({ lat: userLat, lng: userLng });
        }
      } catch (e) {
        console.warn("initLocation error", e);
      }
    };
    initLocation();
    return () => {
      mounted = false;
    };
  }, []);

  // --- camera helper: single place to move camera, with lock + retry if camera not ready ---
  const moveCamera = async (
    lng: number,
    lat: number,
    zoom = 16,
    opts: { force?: boolean } = {}
  ) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const now = Date.now();
    // if camera lock active and not forcing, ignore move
    if (!opts.force && cameraLockRef.current > now) {
      // ignore to prevent jump
      return;
    }
    // try to get camera ref; if not ready, retry a few times
    let attempts = 0;
    const tryMove = async (): Promise<void> => {
      attempts++;
      if (!cameraRef.current) {
        if (attempts > 6) return;
        await new Promise((r) => setTimeout(r, 150));
        return tryMove();
      }
      try {
        // set a short lock so other moves won't race
        cameraLockRef.current = Date.now() + 800; // lock for 800ms
        // prefer setCamera; fall back to flyTo if available
        if (typeof cameraRef.current.setCamera === "function") {
          cameraRef.current.setCamera({
            centerCoordinate: [lng, lat],
            zoomLevel: zoom,
            animationDuration: 600,
          });
        } else if (typeof cameraRef.current.flyTo === "function") {
          cameraRef.current.flyTo([lng, lat], 600);
        } else {
          // fallback: change pickerCenter (the Camera's prop is not controlled below)
          setPickerCenter({ lat, lng });
        }
      } catch (e) {
        console.warn("moveCamera failed, retrying", e);
        if (attempts > 6) return;
        await new Promise((r) => setTimeout(r, 200));
        return tryMove();
      }
    };
    return tryMove();
  };

  // --- GOOGLE PLACES / GEOCODING (kept same) ---
  const DEFAULT_COUNTRY = "MY";
  const performSearch = (text: string) => {
    setSearchQuery(text);
    if (!text || text.length < 3) {
      setSearchResults([]);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      if (!GOOGLE_API_KEY) {
        console.warn("Missing GOOGLE_API_KEY");
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const sessionToken =
          searchSessionTokenRef.current || makeSessionToken();
        searchSessionTokenRef.current = sessionToken;
        const components = DEFAULT_COUNTRY
          ? `components=country:${DEFAULT_COUNTRY}`
          : "";
        const locationBias = userLocation
          ? `&location=${userLocation[1]},${userLocation[0]}&radius=50000`
          : "";
        const typesParam = "types=address";
        const endpoint = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(text)}&key=${GOOGLE_API_KEY}&language=en&${typesParam}&${components}&sessiontoken=${sessionToken}${locationBias}`;
        const res = await fetch(endpoint);
        const data = await res.json();
        if (data.status === "OK" && Array.isArray(data.predictions)) {
          setSearchResults(
            data.predictions.map((p: any) => ({
              place_id: p.place_id,
              description: p.description,
              structured_formatting: p.structured_formatting,
            }))
          );
        } else if (data.status === "ZERO_RESULTS") {
          const fallback = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(text)}&key=${GOOGLE_API_KEY}&language=en&${components}&sessiontoken=${sessionToken}${locationBias}`;
          const r2 = await fetch(fallback);
          const d2 = await r2.json();
          if (d2.status === "OK" && Array.isArray(d2.predictions)) {
            setSearchResults(
              d2.predictions.map((p: any) => ({
                place_id: p.place_id,
                description: p.description,
                structured_formatting: p.structured_formatting,
              }))
            );
          } else {
            console.warn(
              "Places autocomplete status:",
              data.status,
              data.error_message
            );
            setSearchResults([]);
          }
        } else {
          console.warn(
            "Places autocomplete status:",
            data.status,
            data.error_message
          );
          setSearchResults([]);
        }
      } catch (e) {
        console.warn("Places autocomplete error", e);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const fetchPlaceDetails = async (place_id: string) => {
    if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");
    const sessionToken = searchSessionTokenRef.current || undefined;
    const fields = "geometry,formatted_address,address_components,place_id";
    const endpoint = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${GOOGLE_API_KEY}&fields=${fields}${sessionToken ? `&sessiontoken=${sessionToken}` : ""}`;
    const res = await fetch(endpoint);
    const data = await res.json();
    if (data.status === "OK" && data.result) {
      const geom = data.result.geometry;
      const formatted = data.result.formatted_address ?? data.result.name;
      const lat = geom.location.lat,
        lng = geom.location.lng;
      searchSessionTokenRef.current = null;
      return { lat, lng, formatted };
    }
    throw new Error(
      `Place details failed: ${data.status} ${data.error_message ?? ""}`
    );
  };

  const handleSelectPlace = async (item: SearchResult) => {
    Keyboard.dismiss();
    setSearchResults([]);
    setSearchQuery(item.description);
    try {
      setIsSearching(true);
      const details = await fetchPlaceDetails(item.place_id);
      const lat = Number(details.lat),
        lng = Number(details.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        throw new Error("Invalid coordinates from place details");

      setPickerCenter({ lat, lng });
      selectedPlaceNameRef.current =
        details.formatted || item.description || "";
      // use centralised camera mover
      await moveCamera(lng, lat, 17, { force: true });
    } catch (e: any) {
      console.warn("handleSelectPlace error", e);
      Alert.alert(
        "Location lookup failed",
        e?.message ?? "Could not get details for that location."
      );
    } finally {
      setIsSearching(false);
    }
  };

  // open the map picker
  const handleOpenMap = async () => {
    setIsMapPickerOpen(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        const userLng = loc.coords.longitude,
          userLat = loc.coords.latitude;
        setUserLocation([userLng, userLat]);
        const hasValidCoords =
          coords &&
          Number.isFinite(coords.lat) &&
          Number.isFinite(coords.lng) &&
          (coords.lat !== 0 || coords.lng !== 0);
        const initial = hasValidCoords
          ? coords
          : { lat: userLat, lng: userLng };
        setPickerCenter(initial);
        // move camera after slight delay to avoid mount race
        setTimeout(
          () => moveCamera(initial.lng, initial.lat, 16, { force: true }),
          350
        );
      } else {
        const init =
          coords.lat !== 0 || coords.lng !== 0 ? coords : pickerCenter;
        setPickerCenter(init);
        setTimeout(
          () => moveCamera(init.lng, init.lat, 14, { force: true }),
          350
        );
      }
    } catch (e) {
      console.warn("Error opening map", e);
    }
  };

  const handleLocateMe = async () => {
    // prefer userLocation if available
    if (!userLocation) {
      // try fetching current position one-off
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Location permission",
            "Please grant location permission."
          );
          return;
        }
        const loc = await Location.getCurrentPositionAsync({});
        const userLng = loc.coords.longitude,
          userLat = loc.coords.latitude;
        setUserLocation([userLng, userLat]);
        await moveCamera(userLng, userLat, 16, { force: true });
        setPickerCenter({ lat: userLat, lng: userLng });
        return;
      } catch (e) {
        console.warn("locate me fetch error", e);
        Alert.alert("Location error", "Unable to fetch GPS.");
        return;
      }
    }
    // use existing userLocation
    await moveCamera(userLocation[0], userLocation[1], 16, { force: true });
    setPickerCenter({ lat: userLocation[1], lng: userLocation[0] });
  };

  // onRegionDidChange: keep pickerCenter updated (but don't move camera here)
  const onRegionDidChange = (evt: any) => {
    selectedPlaceNameRef.current = null;
    try {
      const coordsFromGeometry = evt?.geometry?.coordinates;
      if (Array.isArray(coordsFromGeometry) && coordsFromGeometry.length >= 2) {
        const [lng, lat] = coordsFromGeometry;
        setPickerCenter({ lat, lng });
        return;
      }
      const propsCenter = evt?.properties?.center;
      if (Array.isArray(propsCenter) && propsCenter.length >= 2) {
        const [lng, lat] = propsCenter;
        setPickerCenter({ lat, lng });
        return;
      }
    } catch (e) {
      console.warn("onRegionDidChange parse error", e);
    }
  };

  const onMapPress = async (evt: any) => {
    try {
      const [lng, lat] = evt?.geometry?.coordinates ?? [];
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        setPickerCenter({ lat, lng });
        await moveCamera(lng, lat, 16, { force: true });
      }
    } catch (e) {
      console.warn("map press parse error", e);
    }
  };

  const confirmLocation = async () => {
    const useCenter =
      Number.isFinite(pickerCenter.lat) && Number.isFinite(pickerCenter.lng)
        ? pickerCenter
        : coords;
    setCoords(useCenter);
    hasManuallySetLocation.current = true;

    if (selectedPlaceNameRef.current) {
      setEditablePlace(selectedPlaceNameRef.current);
      selectedPlaceNameRef.current = null; // Reset after using
      setIsMapPickerOpen(false);
      return;
    }

    // 2. Otherwise, perform the Reverse Geocode lookup (Existing Code)
    if (!GOOGLE_API_KEY) {
      setIsMapPickerOpen(false);
      return;
    }

    try {
      const resultTypes = "street_address,premise,establishment,route";
      const endpoint = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${useCenter.lat},${useCenter.lng}&key=${GOOGLE_API_KEY}&result_type=${resultTypes}&language=en`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (
        data.status === "OK" &&
        Array.isArray(data.results) &&
        data.results.length > 0
      ) {
        const best = data.results[0];
        setEditablePlace(best.formatted_address || editablePlace);
      } else {
        const geoRes = await Location.reverseGeocodeAsync({
          latitude: useCenter.lat,
          longitude: useCenter.lng,
        });
        if (geoRes.length > 0) {
          const address = geoRes[0];
          const formatted = [
            address.name,
            address.streetNumber,
            address.street,
            address.city,
            address.region,
          ]
            .filter(Boolean)
            .join(", ");
          setEditablePlace(formatted || editablePlace);
        }
      }
    } catch (e) {
      console.warn("Reverse geocode failed", e);
    }
    setIsMapPickerOpen(false);
  };

  // --- SUBMIT logic ---
  const uploadImageToStorage = async (
    localUri: string,
    meta: ImageMetadata
  ) => {
    try {
      const response = await fetch(localUri);
      const blob = await response.blob();
      const filename = `reports/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const storageRef = ref(storage, filename);
      const storageMetadata = {
        contentType: "image/jpeg",
        customMetadata: {
          defectType: meta.prediction,
          confidenceScore: meta.confidence,
          allDefects: meta.allDefects || "",
          userDescription: meta.description,
          locationName: meta.place,
          latitude: meta.lat || "0",
          longitude: meta.lng || "0",
          appSource: "RoadDefectApp",
        },
      };
      await uploadBytes(storageRef, blob, storageMetadata);
      const downloadUrl = await getDownloadURL(storageRef);
      return downloadUrl;
    } catch (error) {
      console.error("Upload error", error);
      throw new Error("Failed to upload image to cloud storage");
    }
  };

  const onSubmit = async () => {
    if (submitting || !hasDefects) return;
    setSubmitting(true);
    setUploadProgress("Uploading image...");
    try {
      const confPct = pctFromScore(primaryConfidence);
      const finalCoords =
        Number.isFinite(coords.lat) &&
        Number.isFinite(coords.lng) &&
        (coords.lat !== 0 || coords.lng !== 0)
          ? coords
          : Number.isFinite(pickerCenter.lat) &&
              Number.isFinite(pickerCenter.lng) &&
              (pickerCenter.lat !== 0 || pickerCenter.lng !== 0)
            ? pickerCenter
            : userLocation
              ? { lat: userLocation[1], lng: userLocation[0] }
              : { lat: 0, lng: 0 };
      const finalLocationText =
        editablePlace.trim() || "Location not available";
      let finalImageUrl = null;
      if (uri) {
        const metaForStorage: ImageMetadata = {
          prediction: primaryPrediction,
          confidence: String(confPct),
          allDefects: defectSummary.map((d) => d.label).join(", "),
          description: description.trim(),
          place: finalLocationText,
          lat: String(finalCoords.lat),
          lng: String(finalCoords.lng),
        };
        finalImageUrl = await uploadImageToStorage(uri, metaForStorage);
      }
      setUploadProgress("Saving report...");
      const payload = {
        prediction: capitalize(primaryPrediction),
        confidence: confPct,
        defectsSummary: defectSummary.map((d) => ({
          label: d.label,
          confidence: pctFromScore(d.score),
        })),
        description: description.trim(),
        boxes: parsedBoxes,
        imageUri: uri ?? null,
        imageUrl: finalImageUrl,
        place: finalLocationText,
        location: { lat: finalCoords.lat, lng: finalCoords.lng },
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "reports"), payload);
      Alert.alert("Report submitted", "It will appear on the map shortly.");
      router.back();
    } catch (e: any) {
      console.error(e);
      Alert.alert("Submit failed", e?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
      setUploadProgress("");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Report</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={100}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View
            style={styles.imageFrame}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setFrame({ w: width, h: height });
            }}
          >
            {imageSource ? (
              <>
                <Image
                  source={imageSource}
                  style={styles.image}
                  resizeMode="contain"
                  onLoad={(e) => {
                    const nw = e?.nativeEvent?.source?.width;
                    const nh = e?.nativeEvent?.source?.height;
                    if (nw && nh) setNat({ w: nw, h: nh });
                  }}
                />
                {scaledBoxes.map((b, i) => (
                  <View
                    key={i}
                    pointerEvents="none"
                    style={[
                      styles.box,
                      {
                        left: b.left,
                        top: b.top,
                        width: b.width,
                        height: b.height,
                      },
                    ]}
                  >
                    <View style={styles.boxTag}>
                      <Text style={styles.boxTagText}>
                        {capitalize(b.label)}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.imagePlaceholder} />
            )}
          </View>

          <View style={styles.resultsContainer}>
            {hasDefects ? (
              defectSummary.map((item, index) => {
                const pct = pctFromScore(item.score);
                const isPrimary = index === 0;
                return (
                  <View key={index} style={styles.resultRow}>
                    <View style={styles.resultHeader}>
                      <Text
                        style={[
                          styles.resultLabel,
                          isPrimary && styles.primaryLabel,
                        ]}
                      >
                        {capitalize(item.label)}
                      </Text>
                      <Text style={styles.resultScore}>{pct}% match</Text>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${pct}%`,
                            backgroundColor: isPrimary ? "#FF4444" : "#FFAA00",
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.noDefectsBox}>
                <Ionicons name="alert-circle-outline" size={24} color="#888" />
                <Text style={styles.noDefectsText}>
                  No relevant defects found.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.locationPill}>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationKey}>Location</Text>
              <Text style={{ color: "#7c7a7aff", fontSize: 12 }}>
                You can edit the address or use the map.
              </Text>
              <TextInput
                value={editablePlace}
                onChangeText={setEditablePlace}
                style={styles.locationInput}
                multiline
                placeholder="Tap to add location..."
                placeholderTextColor="#999"
              />
            </View>
            <TouchableOpacity
              style={styles.mapIconButton}
              onPress={handleOpenMap}
            >
              <Ionicons name="map" size={20} color="#3b82f6" />
              <Text style={styles.mapIconText}>Map</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            placeholder="Add a description or notes..."
            style={styles.input}
            placeholderTextColor="#999"
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!hasDefects || submitting) && styles.submitButtonDisabled,
          ]}
          onPress={onSubmit}
          disabled={!hasDefects || submitting}
        >
          {submitting ? (
            <View
              style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
            >
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.submitButtonText}>{uploadProgress}</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>
              {hasDefects ? "Submit Report" : "No Defects Found"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* MAP PICKER */}
      <Modal visible={isMapPickerOpen} animationType="slide">
        <View style={styles.mapModalContainer}>
          <View style={styles.searchOverlay}>
            <View style={styles.searchBar}>
              <Ionicons
                name="search"
                size={20}
                color="#666"
                style={{ marginRight: 8 }}
              />
              <TextInput
                placeholder="Search places..."
                value={searchQuery}
                onChangeText={performSearch}
                style={{ flex: 1, height: 40 }}
              />
              {isSearching && <ActivityIndicator size="small" color="#666" />}
            </View>
            {searchResults.length > 0 && (
              <View style={styles.searchResultsList}>
                <FlatList
                  data={searchResults}
                  keyExtractor={(item) => item.place_id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.searchItem}
                      onPress={() => handleSelectPlace(item as SearchResult)}
                    >
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color="#666"
                      />
                      <Text style={styles.searchItemText}>
                        {item.description}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>

          <MapboxGL.MapView
            style={{ flex: 1 }}
            logoEnabled={false}
            onRegionDidChange={onRegionDidChange}
            onPress={onMapPress}
          >
            {/* NOTE: we no longer bind centerCoordinate as a prop to Camera to avoid constant re-centering races.
                We control camera imperatively via moveCamera(). */}
            <MapboxGL.Camera
              ref={(r) => {
                cameraRef.current = r;
                cameraReadyRef.current = !!r;
              }}
              zoomLevel={16}
              animationMode="flyTo"
              animationDuration={400}
            />
            <MapboxGL.UserLocation
              visible={true}
              onUpdate={(u) => {
                if (u?.coords) {
                  // set userLocation once (do not trigger camera move here to avoid race)
                  setUserLocation(
                    (prev) => prev ?? [u.coords.longitude, u.coords.latitude]
                  );
                }
              }}
            />
          </MapboxGL.MapView>

          <View style={styles.centerMarkerContainer} pointerEvents="none">
            <Ionicons
              name="location"
              size={40}
              color="#FF5555"
              style={{ marginBottom: 40 }}
            />
          </View>

          <TouchableOpacity style={styles.locateMeBtn} onPress={handleLocateMe}>
            <Ionicons name="locate" size={24} color="#333" />
          </TouchableOpacity>

          <View
            style={[
              styles.mapModalFooter,
              { paddingBottom: 20 + Math.max(insets.bottom, 20) },
            ]}
          >
            <Text style={styles.dragHint}>
              Drag map to adjust location or tap the map to place marker
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelMapBtn}
                onPress={() => setIsMapPickerOpen(false)}
              >
                <Text style={styles.cancelMapText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmMapBtn}
                onPress={confirmLocation}
              >
                <Text style={styles.confirmMapText}>Confirm Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* --- styles --- */
const BOX_COLOR = "#00FF66";
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  backButton: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#333" },
  scrollContent: { padding: 16, gap: 20, paddingBottom: 100 },
  imageFrame: {
    width: "100%",
    height: 280,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#eee",
  },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, backgroundColor: "#eee" },
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: BOX_COLOR,
    borderRadius: 4,
  },
  boxTag: {
    position: "absolute",
    left: -2,
    top: -18,
    backgroundColor: BOX_COLOR,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  boxTagText: { color: "#000", fontSize: 10, fontWeight: "800" },
  resultsContainer: { gap: 12 },
  resultRow: { gap: 6 },
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  resultLabel: { fontSize: 18, fontWeight: "600", color: "#333" },
  primaryLabel: { fontSize: 22, fontWeight: "800", color: "#000" },
  resultScore: { fontSize: 14, color: "#666", fontWeight: "500" },
  progressTrack: {
    height: 8,
    backgroundColor: "#eee",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  noDefectsBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 8,
  },
  noDefectsText: {
    textAlign: "center",
    fontSize: 16,
    color: "#888",
    fontStyle: "italic",
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F7FA",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  locationKey: { fontWeight: "700", color: "#444", fontSize: 15 },
  locationInput: {
    color: "#333",
    fontSize: 15,
    padding: 0,
    textAlignVertical: "top",
    minHeight: 20,
    marginTop: 2,
  },
  mapIconButton: {
    alignItems: "center",
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: "#ddd",
  },
  mapIconText: { fontSize: 10, color: "#3b82f6", fontWeight: "600" },
  input: {
    backgroundColor: "#F5F7FA",
    padding: 16,
    borderRadius: 12,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 16,
  },
  footer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  submitButton: {
    backgroundColor: "#FF5555",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    shadowColor: "#FF5555",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: "#CCCCCC",
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  mapModalContainer: { flex: 1, backgroundColor: "#fff" },
  centerMarkerContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  searchOverlay: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
  },
  searchResultsList: {
    backgroundColor: "#fff",
    marginTop: 5,
    borderRadius: 8,
    elevation: 5,
    maxHeight: 200,
  },
  searchItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  searchItemText: { marginLeft: 10, color: "#333", fontSize: 14 },
  locateMeBtn: {
    position: "absolute",
    bottom: 200,
    right: 20,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 30,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  mapModalFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  dragHint: { textAlign: "center", color: "#666", marginBottom: 15 },
  modalBtnRow: { flexDirection: "row", gap: 10 },
  cancelMapBtn: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  confirmMapBtn: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#3b82f6",
    alignItems: "center",
  },
  cancelMapText: { fontWeight: "600", color: "#333" },
  confirmMapText: { fontWeight: "600", color: "#fff" },
});

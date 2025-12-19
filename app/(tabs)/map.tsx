import { db } from "@/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import MapboxGL from "@rnmapbox/maps";
import * as turf from "@turf/turf";
import Constants from "expo-constants";
import * as Location from "expo-location";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
} from "firebase/storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

/* ---------------- CONFIG / TOKENS ---------------- */
const extra = Constants.expoConfig?.extra || {};
const MAPBOX_ACCESS_TOKEN: string = extra.MAPBOX_ACCESS_TOKEN || "";
const GOOGLE_API_KEY: string = extra.GOOGLE_API_KEY || "";

if (!MAPBOX_ACCESS_TOKEN) {
  console.warn(
    "[MapScreen] MAPBOX_ACCESS_TOKEN is missing. Set it in app.config.js → extra."
  );
}

MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);

/* ---------------- TYPES ---------------- */
type ReportDoc = {
  id: string;
  prediction?: string;
  place?: string;
  streetName?: string;
  location?: { lat: number; lng: number } | null;
  imageUrl?: string | null;
  imageUri?: string | null;
  dataUri?: string | null;
  cityLabel?: string;
};

/* ---------------- SMALL UTILITIES ---------------- */
const chunkArray = <T,>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const { width } = Dimensions.get("window");
const CARD_WIDTH = width * 0.9;
const SPACING = width * 0.05;

/* -------------- COMPONENT --------------- */
const MapScreen = () => {
  const [iriGeoJSON, setIriGeoJSON] = useState<any>(null);
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [swipableReports, setSwipableReports] = useState<ReportDoc[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("Initializing...");
  const [isManualInput, setIsManualInput] = useState(true);

  const cameraRef = useRef<MapboxGL.Camera>(null);
  // 2. Create Ref for FlatList
  const flatListRef = useRef<FlatList>(null);

  const [centerCoord, setCenterCoord] = useState<[number, number]>([
    101.5853, 3.0742,
  ]);
  const { focusId } = useLocalSearchParams();

  /* ---------- Helper: Snap Reports via Mapbox Matching ---------- */
  const snapReportsToRoads = async (
    rawReports: ReportDoc[]
  ): Promise<ReportDoc[]> => {
    if (!MAPBOX_ACCESS_TOKEN) return rawReports;

    try {
      const validReportsWithIndex = rawReports
        .map((r, idx) => ({ r, idx }))
        .filter(
          ({ r }) =>
            r.location && isFinite(r.location.lat) && isFinite(r.location.lng)
        );

      if (validReportsWithIndex.length === 0) return rawReports;

      const updated = [...rawReports];
      const chunks = chunkArray(validReportsWithIndex, 100);

      for (const chunk of chunks) {
        const coordsString = chunk
          .map(({ r }) => `${r.location!.lng},${r.location!.lat}`)
          .join(";");
        const radiuses = chunk.map(() => 50).join(";");

        const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordsString}?access_token=${MAPBOX_ACCESS_TOKEN}&radiuses=${radiuses}&tidy=true&geometries=geojson`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.code === "Ok" && Array.isArray(data.tracepoints)) {
          data.tracepoints.forEach((tp: any, i: number) => {
            if (!tp) return;
            const chunkItem = chunk[i];
            if (!chunkItem) return;
            const rawIndex = chunkItem.idx;

            if (Array.isArray(tp.location) && tp.location.length === 2) {
              updated[rawIndex] = {
                ...updated[rawIndex],
                location: {
                  lat: tp.location[1],
                  lng: tp.location[0],
                },
                streetName: tp.name || updated[rawIndex].streetName,
              };
            }
          });
        }
      }

      return updated;
    } catch (error) {
      console.warn("Snap reports failed:", error);
      return rawReports;
    }
  };

  /* ---------------- Handler: Marker Click ---------------- */
  const handleMarkerPress = async (report: ReportDoc) => {
    if (!report.location) return;

    const clickedPoint = turf.point([report.location.lng, report.location.lat]);

    // Sort: The clicked report will be at Index 0 (Distance 0)
    const sortedNearby = reports
      .map((r) => {
        if (!r.location) return { ...r, dist: 999999 };
        const p = turf.point([r.location.lng, r.location.lat]);
        return { ...r, dist: turf.distance(clickedPoint, p) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 20);

    setSwipableReports(sortedNearby);

    // 3. Force Scroll to Index 0 whenever we select a marker
    // use a slight delay to allow the state to update and list to render
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);

    // Fly camera to selected
    cameraRef.current?.setCamera({
      centerCoordinate: [report.location.lng, report.location.lat],
      zoomLevel: 17,
      animationDuration: 1000,
    });

    geocodeAndUpdate(report);
  };

  const geocodeAndUpdate = async (report: ReportDoc) => {
    try {
      if (report.location) {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: report.location.lat,
          longitude: report.location.lng,
        });

        if (geocode.length > 0) {
          const res = geocode[0];
          const cityLabel =
            res.subregion ||
            res.city ||
            res.district ||
            res.region ||
            "Unknown area";

          setSwipableReports((prev) =>
            prev.map((p) => (p.id === report.id ? { ...p, cityLabel } : p))
          );
        }
      }
    } catch (error) {
      console.warn(error);
    }
  };

  /* ----------------Handle Deep Linking Safely ---------------- */
  // 4. Use useFocusEffect to reliably trigger when switching Tabs
  useFocusEffect(
    useCallback(() => {
      // Wait a moment for the screen to settle
      const timer = setTimeout(() => {
        if (!loading && reports.length > 0 && focusId) {
          const targetReport = reports.find((r) => r.id === focusId);
          if (targetReport) {
            handleMarkerPress(targetReport);
          }
        }
      }, 500); // 500ms delay to ensure map is ready

      return () => clearTimeout(timer);
    }, [focusId, loading, reports])
  );

  /* ---------------- Handler: Swipe Change ---------------- */
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const item = viewableItems[0].item as ReportDoc;
      if (item.location) {
        cameraRef.current?.setCamera({
          centerCoordinate: [item.location.lng, item.location.lat],
          animationDuration: 500,
        });

        if (!item.cityLabel) geocodeAndUpdate(item);
      }
    }
  }).current;

  /* ---------------- MAIN DATA LOADING ---------------- */
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!MAPBOX_ACCESS_TOKEN) {
          setStatusText("MAPBOX_ACCESS_TOKEN missing.");
        }

        setStatusText("Getting Location...");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({});
          setCenterCoord([pos.coords.longitude, pos.coords.latitude]);
        }

        setStatusText("Loading road condition overlay...");
        try {
          const storage = getStorage();
          const iriRef = storageRef(storage, "iri/iri_latest.geojson");
          const url = await getDownloadURL(iriRef);
          const resp = await fetch(url);
          const geojson = await resp.json();
          setIriGeoJSON(geojson);
        } catch (e) {
          console.warn("Failed to load iri_latest.geojson:", e);
          setIriGeoJSON(null);
        }

        setStatusText("Loading Defect Reports...");
        const reportSnap = await getDocs(collection(db, "reports"));
        let rows: ReportDoc[] = [];
        reportSnap.forEach((d) => {
          const v: any = d.data();
          rows.push({
            id: d.id,
            prediction: v.prediction ?? "Defect",
            place: v.place ?? "Unknown Area",
            streetName: v.streetName ?? "",
            location: v.location ?? null,
            imageUrl: v.imageUrl ?? null,
            imageUri: v.imageUri ?? null,
            dataUri: v.dataUri ?? null,
          });
        });

        const snappedRows = await snapReportsToRoads(rows);
        setReports(
          snappedRows.filter(
            (r) =>
              r.location && isFinite(r.location.lat) && isFinite(r.location.lng)
          )
        );
      } catch (error) {
        console.warn("Error in MapScreen:", error);
        Alert.alert("Error", "Something went wrong while loading map data.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  /* ---------------- Search (Google Places) ---------------- */
  useEffect(() => {
    if (!isManualInput) return;
    if (!GOOGLE_API_KEY) return;

    const fetchSuggestions = async () => {
      if (searchQuery.length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            searchQuery
          )}&key=${GOOGLE_API_KEY}`
        );
        const data = await res.json();
        setSuggestions(data.status === "OK" ? data.predictions : []);
      } catch (e) {
        console.warn("Places autocomplete error:", e);
      }
    };
    fetchSuggestions();
  }, [searchQuery, isManualInput]);

  const handleSelectSuggestion = async (placeId: string) => {
    if (!GOOGLE_API_KEY) return;
    try {
      setIsManualInput(false);
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`
      );
      const data = await res.json();
      const loc = data.result?.geometry?.location;
      if (loc) {
        cameraRef.current?.setCamera({
          centerCoordinate: [loc.lng, loc.lat],
          zoomLevel: 20,
          animationDuration: 1000,
        });
        setSearchQuery(data.result.name);
        setSuggestions([]);
        Keyboard.dismiss();
      }
    } catch (e) {
      console.warn("Place details error:", e);
    }
  };

  /* ---------------- Nearby Defects ---------------- */
  const handleShowNearbyDefects = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const userLoc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = userLoc.coords;

      const from = turf.point([longitude, latitude]);
      const nearby = reports.filter((r) => {
        if (!r.location) return false;
        const to = turf.point([r.location.lng, r.location.lat]);
        return (
          turf.distance(from, to, {
            units: "kilometers",
          }) <= 0.5
        );
      });

      if (nearby.length === 0) {
        Alert.alert("Info", "No defects reported within 500m.");
        cameraRef.current?.setCamera({
          centerCoordinate: [longitude, latitude],
          zoomLevel: 17,
          animationDuration: 1000,
        });
      } else {
        const points = nearby.map((r) => [r.location!.lng, r.location!.lat]);
        points.push([longitude, latitude]);
        const bbox = turf.bbox(turf.lineString(points as any));
        cameraRef.current?.fitBounds(
          [bbox[2], bbox[3]],
          [bbox[0], bbox[1]],
          [100, 50, 100, 50],
          1000
        );
      }
    } catch (e) {
      console.warn("Nearby defects error:", e);
    }
  };

  /* ---------------- CARD RENDER ITEM ---------------- */
  const renderCardItem = ({ item }: { item: ReportDoc }) => {
    const rawUrl = item.imageUrl || item.imageUri;
    const selectedImageSrc = rawUrl ? { uri: rawUrl } : null;

    return (
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          <View style={styles.infoColumn}>
            <View style={styles.addressRow}>
              <Ionicons name="location-outline" size={18} color="#000" />
              <Text style={styles.streetText} numberOfLines={1}>
                {item.cityLabel || "Unknown area"}
              </Text>
            </View>

            <Text style={styles.placeText}>
              {item.place || item.streetName || "Unknown road"}
            </Text>

            <View style={styles.typeContainer}>
              <Text style={styles.typeLabel}>Type: </Text>
              <Text style={styles.typeValue}>{item.prediction}</Text>
            </View>
          </View>

          <View style={styles.imageContainer}>
            {selectedImageSrc ? (
              <Image
                source={selectedImageSrc}
                style={styles.defectImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.noImage}>
                <Text style={{ fontSize: 10, color: "#888" }}>No Image</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search & Button Overlay */}
      <View style={styles.overlayContainer} pointerEvents="box-none">
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={(t) => {
              setIsManualInput(true);
              setSearchQuery(t);
            }}
            placeholder="Search location..."
            style={styles.searchBar}
            placeholderTextColor="#999"
            onSubmitEditing={() => {
              setSuggestions([]);
              Keyboard.dismiss();
            }}
          />
          {suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSelectSuggestion(item.place_id)}
                >
                  <Text style={styles.suggestionText}>{item.description}</Text>
                </TouchableOpacity>
              )}
              style={styles.suggestionsList}
            />
          )}
        </View>
        <TouchableOpacity
          style={styles.nearbyButton}
          onPress={handleShowNearbyDefects}
          activeOpacity={0.8}
        >
          <Ionicons name="warning" size={20} color="#fff" />
          <Text style={styles.nearbyButtonText}>Defects Near Me</Text>
        </TouchableOpacity>
      </View>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="small" color="#333" />
          <Text style={styles.loaderText}>{statusText}</Text>
        </View>
      )}

      {/* MAP */}
      <MapboxGL.MapView
        style={styles.map}
        logoEnabled={false}
        onPress={() => setSwipableReports([])}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          zoomLevel={15}
          centerCoordinate={centerCoord}
          animationMode="flyTo"
          animationDuration={0}
        />
        <MapboxGL.UserLocation androidRenderMode="gps" />

        {iriGeoJSON && (
          <MapboxGL.ShapeSource id="iriSource" shape={iriGeoJSON}>
            <MapboxGL.LineLayer
              id="iriLines"
              style={{
                lineWidth: 5,
                lineCap: "round",
                lineJoin: "round",
                lineColor: ["get", "color"],
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {reports.map((r) =>
          r.location ? (
            <MapboxGL.PointAnnotation
              key={r.id}
              id={r.id}
              coordinate={[r.location.lng, r.location.lat]}
              onSelected={() => handleMarkerPress(r)}
            >
              <View style={styles.dotWrap}>
                <View style={styles.dotCore} />
              </View>
            </MapboxGL.PointAnnotation>
          ) : null
        )}
      </MapboxGL.MapView>

      {/* SWIPABLE CARDS LIST */}
      {swipableReports.length > 0 && (
        <View style={styles.listContainer}>
          <FlatList
            ref={flatListRef} // 5. Attach Ref here
            data={swipableReports}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={width}
            decelerationRate="fast"
            renderItem={renderCardItem}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={{
              itemVisiblePercentThreshold: 50,
            }}
            style={{ flexGrow: 0 }}
          />
        </View>
      )}
    </View>
  );
};

/* ---------------- STYLES ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  map: { flex: 1 },
  overlayContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  searchContainer: { marginBottom: 10 },
  searchBar: {
    backgroundColor: "#fff",
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    elevation: 4,
  },
  suggestionsList: {
    backgroundColor: "#fff",
    marginTop: 6,
    borderRadius: 12,
    elevation: 4,
    maxHeight: 200,
  },
  suggestionItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  suggestionText: {
    fontSize: 14,
    color: "#333",
  },
  nearbyButton: {
    alignSelf: "flex-end",
    backgroundColor: "#EF4444",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 25,
    elevation: 5,
  },
  nearbyButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    marginLeft: 6,
  },
  loader: {
    position: "absolute",
    top: 170,
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: 10,
    borderRadius: 20,
    zIndex: 90,
    flexDirection: "row",
    alignItems: "center",
  },
  loaderText: {
    marginLeft: 8,
    fontSize: 12,
    color: "#333",
  },

  dotWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(248, 0, 132, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ac188fff",
    borderWidth: 1.5,
    borderColor: "#fff",
  },

  /* LIST CONTAINER */
  listContainer: {
    position: "absolute",
    bottom: 130,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  cardWrapper: {
    width: width, // Full width for paging
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    backgroundColor: "#fff",
    width: "100%",
    borderRadius: 20,
    padding: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  infoColumn: {
    flex: 1,
    justifyContent: "center",
    paddingRight: 10,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  streetText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
    marginLeft: 4,
  },
  placeText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  typeContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  typeLabel: { fontSize: 14, color: "#666" },
  typeValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  imageContainer: {
    width: 110,
    height: 100,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#f2f2f2",
  },
  defectImage: { width: "100%", height: "100%" },
  noImage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default MapScreen;

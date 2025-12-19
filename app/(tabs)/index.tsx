import { auth, db } from "@/firebaseConfig";
import { Ionicons } from "@expo/vector-icons";
import * as turf from "@turf/turf";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
} from "firebase/storage";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/* ---------------- TYPES ---------------- */
type ReportDoc = {
  id: string;
  prediction?: string;
  place?: string;
  streetName?: string;
  cityLabel?: string;
  location?: { lat: number; lng: number } | null;
  imageUrl?: string | null;
  imageUri?: string | null;
  status?: "open" | "fixed";
  createdAt?: any;
};

type AreaStats = {
  roadsScannedKm: number;
  avgIri: number;
  totalDefects: number;
  defectsFixed: number;
};

/* ---------------- HELPERS ---------------- */
const toDateFromFirestore = (ts: any): Date | null => {
  try {
    if (!ts) return null;
    if (typeof ts === "object" && typeof ts.toDate === "function")
      return ts.toDate();
    if (typeof ts === "object" && typeof ts.seconds === "number") {
      const sec = Number(ts.seconds);
      const nsec = Number(ts.nanoseconds || 0);
      return new Date(sec * 1000 + Math.round(nsec / 1e6));
    }
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts === "string") {
      const maybe = Date.parse(ts);
      if (!isNaN(maybe)) return new Date(maybe);
      return null;
    }
  } catch (e) {
    return null;
  }
  return null;
};

const timeAgo = (createdAt: any): string => {
  const d = toDateFromFirestore(createdAt);
  if (!d) return "Unknown time";
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 0) return "Just now";
  if (sec < 60) return `${sec} sec${sec !== 1 ? "s" : ""} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min !== 1 ? "s" : ""} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} yr${years !== 1 ? "s" : ""} ago`;
};

/* ---------------- COMPONENT ---------------- */
const HomeScreen = () => {
  const [userName, setUserName] = useState<string>("User");
  const [address, setAddress] = useState<string>("Locating...");
  const [stats, setStats] = useState<AreaStats>({
    roadsScannedKm: 0,
    avgIri: 0,
    totalDefects: 0,
    defectsFixed: 0,
  });
  const [recentReports, setRecentReports] = useState<ReportDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { width } = Dimensions.get("window");
  const CARD_WIDTH = width * 0.7;
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // 1. Fetch User Name
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const userDocRef = doc(db, "users", currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          // 1. Name
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const nameToDisplay = userData.displayName || userData.fullName;
            if (nameToDisplay) {
              const firstName = nameToDisplay.trim().split(" ")[0];
              setUserName(firstName);
            }

            // 2. Firestore photo fallback
            if (userData.photoURL) {
              setProfilePhoto(userData.photoURL);
            }
          }

          // 3. Firebase Auth photo (highest priority)
          if (currentUser.photoURL) {
            setProfilePhoto(currentUser.photoURL);
          }
        } catch (err) {
          console.warn("Error fetching user profile:", err);
        }
      }

      // 2. Permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setAddress("Permission Denied");
        setLoading(false);
        return;
      }

      // 3. Current Location
      const loc = await Location.getCurrentPositionAsync({});
      const userPoint = turf.point([loc.coords.longitude, loc.coords.latitude]);
      const SEARCH_RADIUS_KM = 10;

      // Reverse geocode
      const geocode = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geocode.length > 0) {
        setAddress(geocode[0].city || geocode[0].subregion || "Your Area");
      }

      // ===========================
      // PART A: IRI Stats
      // ===========================
      let roadsScannedKm = 0;
      let avgIri = 0;
      try {
        const storage = getStorage();
        const iriRef = storageRef(storage, "iri/iri_latest.geojson");
        const url = await getDownloadURL(iriRef);
        const res = await fetch(url);
        const geojson = await res.json();

        if (
          geojson &&
          geojson.type === "FeatureCollection" &&
          Array.isArray(geojson.features)
        ) {
          let lengthSum = 0;
          let iriLengthSum = 0;

          geojson.features.forEach((f: any) => {
            if (!f || f.type !== "Feature") return;
            const geom = f.geometry;
            if (!geom || geom.type !== "LineString") return;
            const coords = geom.coordinates;
            const line = turf.lineString(coords);

            const midIdx = Math.floor(coords.length / 2);
            const mid = turf.point(coords[midIdx]);
            if (
              turf.distance(userPoint, mid, { units: "kilometers" }) >
              SEARCH_RADIUS_KM
            )
              return;

            const lenKm = turf.length(line, { units: "kilometers" });
            const iriProp = f.properties?.iri;
            const iriVal =
              typeof iriProp === "number" ? iriProp : Number(iriProp);

            if (isFinite(lenKm) && lenKm > 0 && isFinite(iriVal)) {
              lengthSum += lenKm;
              iriLengthSum += iriVal * lenKm;
            }
          });

          if (lengthSum > 0) {
            roadsScannedKm = lengthSum;
            avgIri = iriLengthSum / lengthSum;
          }
        }
      } catch (err) {
        console.warn("Failed to load IRI:", err);
      }

      // ===========================
      // PART B: DEFECT REPORTS
      // ===========================
      const reportsQ = query(
        collection(db, "reports"),
        orderBy("createdAt", "desc"),
        limit(20)
      );
      const reportsSnap = await getDocs(reportsQ);

      let localDefects = 0;
      let fixedDefects = 0;
      const nearbyReports: ReportDoc[] = [];

      for (const doc of reportsSnap.docs) {
        const d: any = doc.data();
        if (!d.location) continue;
        const pt = turf.point([d.location.lng, d.location.lat]);

        if (
          turf.distance(userPoint, pt, { units: "kilometers" }) <=
          SEARCH_RADIUS_KM
        ) {
          localDefects++;
          if (d.status === "fixed") fixedDefects++;

          if (nearbyReports.length < 10) {
            let cityLabel = d.place || "Unknown Area";
            try {
              const geoRes = await Location.reverseGeocodeAsync({
                latitude: d.location.lat,
                longitude: d.location.lng,
              });
              if (geoRes.length > 0) {
                cityLabel =
                  geoRes[0].city ||
                  geoRes[0].subregion ||
                  geoRes[0].district ||
                  cityLabel;
              }
            } catch (e) {
              console.log("Geocode error for report:", e);
            }

            nearbyReports.push({
              id: doc.id,
              prediction: d.prediction,
              place: d.place,
              streetName: d.streetName,
              cityLabel: cityLabel,
              location: d.location,
              imageUrl: d.imageUrl,
              imageUri: d.imageUri,
              status: d.status,
              createdAt: d.createdAt ?? d.timestamp ?? null,
            });
          }
        }
      }

      setStats({
        avgIri,
        roadsScannedKm,
        totalDefects: localDefects,
        defectsFixed: fixedDefects,
      });
      setRecentReports(nearbyReports);
    } catch (e) {
      console.warn("Home fetch error:", e);
      setAddress("Error locating");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 12) return "Good Morning";
    if (hrs < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const getIriColor = (iri: number) => {
    if (iri < 2.5) return { color: "#22c55e", label: "Good" };
    if (iri < 4.5) return { color: "#eab308", label: "Fair" };
    return { color: "#ef4444", label: "Poor" };
  };

  const renderStatCard = (
    title: string,
    value: string | number,
    icon: any,
    color: string,
    subLabel?: string
  ) => (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: color + "20" }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
      {subLabel && <Text style={styles.statSub}>{subLabel}</Text>}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>
              {getGreeting()}, {userName}
            </Text>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={16} color="#ef4444" />
              <Text style={styles.locationText}>{address}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.profileBtn}
            onPress={() => router.push("/(tabs)/profile")}
          >
            {profilePhoto ? (
              <Image
                source={{ uri: profilePhoto }}
                style={styles.profileImage}
              />
            ) : (
              <Ionicons name="person" size={24} color="#555" />
            )}
          </TouchableOpacity>
        </View>

        {/* SECTION: YOUR AREA STATS */}
        <Text style={styles.sectionTitle}>Your Area Overview</Text>
        <View style={styles.statsGrid}>
          {renderStatCard(
            "Roads Scanned",
            stats.roadsScannedKm.toFixed(1) + " km",
            "map-outline",
            "#3b82f6"
          )}
          {renderStatCard(
            "Average Condition",
            getIriColor(stats.avgIri).label,
            "pulse-outline",
            getIriColor(stats.avgIri).color,
            `IRI: ${stats.avgIri.toFixed(1)}`
          )}
          {renderStatCard(
            "Defects Found",
            stats.totalDefects,
            "alert-circle-outline",
            "#ef4444"
          )}
          {renderStatCard(
            "Patched",
            stats.defectsFixed,
            "construct-outline",
            "#22c55e"
          )}
        </View>

        {/* SECTION: Defects In Your Area */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Defects In Your Area</Text>
          {recentReports.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{recentReports.length} New</Text>
            </View>
          )}
        </View>

        {loading ? (
          <ActivityIndicator
            style={{ marginTop: 20 }}
            size="large"
            color="#333"
          />
        ) : recentReports.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#ddd" />
            <Text style={styles.emptyText}>No new defects in your area.</Text>
          </View>
        ) : (
          <FlatList
            data={recentReports}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingLeft: 20,
              paddingRight: 5,
              paddingBottom: 20,
            }}
            keyExtractor={(item) => item.id}
            snapToInterval={CARD_WIDTH + 15}
            decelerationRate="fast"
            renderItem={({ item }) => {
              const rawUrl = item.imageUrl || item.imageUri;
              const selectedImageSrc = rawUrl ? { uri: rawUrl } : null;

              return (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    // Navigate to Map Tab and pass the ID
                    router.push({
                      pathname: "/(tabs)/map",
                      params: { focusId: item.id },
                    });
                  }}
                  style={[
                    styles.verticalCard,
                    { width: CARD_WIDTH, marginRight: 15 },
                  ]}
                >
                  {/* TOP: Image */}
                  <View style={styles.cardImageTopWrap}>
                    {selectedImageSrc ? (
                      <Image
                        source={selectedImageSrc}
                        style={styles.cardImageTop}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.cardImageTop, styles.noImageState]}>
                        <Ionicons name="image-outline" size={24} color="#ccc" />
                        <Text style={{ fontSize: 10, color: "#999" }}>
                          No Image
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* BOTTOM: Content */}
                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.cityLabel}
                    </Text>
                    <View style={styles.locationRowCard}>
                      <Ionicons name="location-sharp" size={12} color="#888" />
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        {item.streetName || item.place || "Unknown Location"}
                      </Text>
                    </View>
                    <View style={styles.cardFooter}>
                      <View style={styles.tagPill}>
                        <Text style={styles.tagText}>
                          {item.prediction || "Defect"}
                        </Text>
                      </View>
                      <Text style={styles.timeLabel}>
                        {timeAgo(item.createdAt)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/* ---------------- STYLES ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA" },
  scrollContent: { paddingBottom: 100 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  greeting: { fontSize: 22, fontWeight: "800", color: "#111" },
  locationRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  locationText: {
    fontSize: 14,
    color: "#666",
    marginLeft: 4,
    fontWeight: "500",
  },
  profileBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#eee",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
    marginLeft: 20,
    marginBottom: 15,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
  },
  badge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 10,
    marginBottom: 12,
  },
  badgeText: { color: "#ef4444", fontSize: 12, fontWeight: "700" },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 15,
    justifyContent: "space-between",
  },
  statCard: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  statValue: { fontSize: 20, fontWeight: "800", color: "#111" },
  statTitle: { fontSize: 13, color: "#666", marginTop: 2 },
  statSub: { fontSize: 11, color: "#999", marginTop: 4 },
  verticalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 5,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: "hidden",
  },
  cardImageTopWrap: { width: "100%", height: 140, backgroundColor: "#f0f0f0" },
  cardImageTop: { width: "100%", height: "100%" },
  noImageState: { alignItems: "center", justifyContent: "center" },
  cardContent: { padding: 12 },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
    marginBottom: 4,
  },
  locationRowCard: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  cardSubtitle: { fontSize: 13, color: "#666", marginLeft: 4 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#f3f3f3",
    paddingTop: 10,
  },
  tagPill: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: { fontSize: 12, fontWeight: "700", color: "#EF4444" },
  timeLabel: { fontSize: 12, color: "#999" },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    opacity: 0.5,
  },
  emptyText: { marginTop: 10, fontSize: 14, color: "#666" },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
});

export default HomeScreen;

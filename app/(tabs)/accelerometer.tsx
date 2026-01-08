import { useSensorLogger } from "@/context/SensorLoggerContext";
import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LineChart } from "react-native-chart-kit";

// Import the alert image
const alertImage = require("../../assets/images/accelerometer_alert.jpg");

const VEHICLE_OPTIONS = [
  "Hatchback/ Small Car (e.g. Myvi, Axia, Jazz)",
  "Sedan/ Normal car (e.g. City, Vios, Civic)",
  "SUV/ MPV (e.g. HR-V, X70, Alza)",
  "Pickup/ Light Truck (e.g. Hilux, Ford Ranger)",
  "Bus/ Lorry",
];

// Tailwind Color Map for reference
const COLORS = {
  gray50: "#F9FAFB",
  gray100: "#F3F4F6",
  gray200: "#E5E7EB",
  gray300: "#D1D5DB",
  gray400: "#9CA3AF",
  gray600: "#4B5563",
  gray700: "#374151",
  gray800: "#1F2937",
  gray900: "#111827",
  blue50: "#EFF6FF",
  blue100: "#DBEAFE",
  blue200: "#BFDBFE",
  blue500: "#3B82F6",
  blue600: "#2563EB",
  blue700: "#1D4ED8",
  red100: "#FEE2E2",
  red200: "#FECACA",
  red600: "#DC2626",
  green500: "#22C55E",
  white: "#FFFFFF",
  blackOverlay: "rgba(0, 0, 0, 0.5)",
};

export default function AccelerometerScreen() {
  const { log, logging, startNew, pause, resume, clear } = useSensorLogger();
  const [sessionStarted, setSessionStarted] = useState(false);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [showVehicleMenu, setShowVehicleMenu] = useState(false);

  const [showInstructionModal, setShowInstructionModal] = useState(false);

  const screenWidth = Dimensions.get("window").width;

  // Chart Data Preparation
  const recentLog = log.slice(-50);
  const chartDataPoints =
    recentLog.length > 0 ? recentLog.map((d) => d.y) : [0];
  const chartLabels = chartDataPoints.map(() => "");

  const maxValue = Math.max(...log.map((d) => d.y), 0);
  const latestValue = log.length > 0 ? log[log.length - 1].y : 0;

  const exportLog = async () => {
    if (log.length === 0) {
      Alert.alert("No Data", "Please start a session first.");
      return;
    }
    try {
      const file = new File(Paths.document, "vibration_log.json");
      file.write(JSON.stringify(log), { encoding: "utf8" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert("Not Supported", "Your device doesn't support sharing.");
      }
    } catch (error: unknown) {
      Alert.alert(
        "Export Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  // --- NEW CLEAR LOGIC ---
  const handleClear = () => {
    Alert.alert(
      "Clear Session",
      "Are you sure you want to reset the screen? The previous data have been saved to cloud.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            // 1. Reset local UI state
            setSessionStarted(false);
            setVehicleType(null);

            // 2. Clear data in Context
            if (clear) {
              clear();
            } else {
              console.warn("clear() function not found in SensorLoggerContext");
            }
          },
        },
      ]
    );
  };

  const handleStartPress = () => {
    if (!vehicleType) {
      Alert.alert("Select Vehicle", "Please choose a vehicle type first.");
      return;
    }
    setShowInstructionModal(true);
  };

  const confirmStartSession = () => {
    setShowInstructionModal(false);
    if (vehicleType) {
      startNew(vehicleType);
      setSessionStarted(true);
    }
  };

  return (
    <View style={styles.container}>
      {/* --- CUSTOM INSTRUCTION MODAL --- */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showInstructionModal}
        onRequestClose={() => setShowInstructionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons
                name="information-circle"
                size={24}
                color={COLORS.blue600}
              />
              <Text style={styles.modalTitle}>Setup Required</Text>
            </View>

            <Image
              source={alertImage}
              style={styles.modalImage}
              resizeMode="contain"
            />

            <Text style={styles.modalText}>
              Please ensure your phone is mounted securely in an{" "}
              <Text style={styles.boldText}>upright position (Y-axis)</Text>,
              using a holder on the dashboard or air vent.
              {"\n\n"}
              This is required for accurate data readings and IRI road condition
              calculations.
            </Text>

            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                onPress={() => setShowInstructionModal(false)}
                style={styles.modalButtonCancel}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmStartSession}
                style={styles.modalButtonConfirm}
              >
                <Text style={styles.modalButtonConfirmText}>I'm Ready</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: Platform.OS === "android" ? 50 : 60,
          paddingBottom: 150,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Row */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Accelerometer</Text>
          <TouchableOpacity style={styles.exportButton} onPress={exportLog}>
            <Text style={styles.exportButtonText}>Export data</Text>
          </TouchableOpacity>
        </View>

        {/* --- DROPDOWN SECTION --- */}
        <View style={styles.dropdownSection}>
          <Text style={styles.sectionLabel}>Session Configuration</Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setShowVehicleMenu((prev) => !prev)}
            style={[
              styles.dropdownButton,
              showVehicleMenu
                ? styles.dropdownButtonActive
                : styles.dropdownButtonInactive,
            ]}
          >
            <View style={styles.dropdownIconContainer}>
              <Ionicons name="car-sport" size={20} color={COLORS.blue600} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dropdownLabel}>Vehicle Used</Text>
              <Text style={styles.dropdownValue}>
                {vehicleType || "Select Your Vehicle Type"}
              </Text>
            </View>
            <Ionicons
              name={showVehicleMenu ? "chevron-up" : "chevron-down"}
              size={20}
              color={COLORS.gray400}
            />
          </TouchableOpacity>

          {showVehicleMenu && (
            <View style={styles.dropdownMenu}>
              {VEHICLE_OPTIONS.map((opt, index) => {
                const isSelected = vehicleType === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    activeOpacity={0.7}
                    onPress={() => {
                      setVehicleType(opt);
                      setShowVehicleMenu(false);
                    }}
                    style={[
                      styles.dropdownOption,
                      index !== VEHICLE_OPTIONS.length - 1 &&
                        styles.borderBottom,
                      isSelected && styles.dropdownOptionSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}
                    >
                      {opt}
                    </Text>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={COLORS.blue600}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* --- CHART CONTAINER --- */}
        <View style={styles.chartContainer}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Vertical Vibration Signal</Text>
            <View style={styles.chartStatus}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: logging ? COLORS.green500 : COLORS.gray300,
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {logging ? "Recording" : "Idle"}
              </Text>
            </View>
          </View>

          <LineChart
            data={{
              labels: chartLabels,
              datasets: [
                {
                  data: chartDataPoints,
                  color: (opacity = 1) => `rgba(239, 68, 68, ${opacity})`,
                  strokeWidth: 2,
                },
              ],
            }}
            width={screenWidth - 64}
            height={220}
            withDots={false}
            withInnerLines={true}
            withOuterLines={false}
            withVerticalLabels={false}
            yAxisSuffix="g"
            chartConfig={{
              backgroundColor: "#ffffff",
              backgroundGradientFrom: "#ffffff",
              backgroundGradientTo: "#ffffff",
              decimalPlaces: 1,
              color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(156, 163, 175, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForBackgroundLines: {
                strokeDasharray: "",
                stroke: "#F3F4F6",
              },
            }}
            bezier
            style={{
              marginVertical: 8,
              borderRadius: 16,
            }}
          />
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Maximum</Text>
            <Text style={styles.statValue}>{maxValue.toFixed(2)}</Text>
            <Text style={styles.statUnit}>m/s²</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Latest</Text>
            <Text style={styles.statValueBlue}>{latestValue.toFixed(2)}</Text>
            <Text style={styles.statUnit}>m/s²</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controlsRow}>
          {/* Start New Session */}
          <TouchableOpacity
            onPress={handleStartPress}
            activeOpacity={0.8}
            style={styles.btnStart}
          >
            <Text style={styles.btnStartText}>New Session</Text>
          </TouchableOpacity>

          {/* Pause / Resume */}
          <TouchableOpacity
            disabled={!sessionStarted}
            onPress={logging ? pause : resume}
            activeOpacity={0.8}
            style={[
              styles.btnPause,
              sessionStarted ? styles.btnPauseActive : styles.btnPauseInactive,
            ]}
          >
            <Ionicons
              name={logging ? "pause" : "play"}
              size={24}
              color={sessionStarted ? "white" : COLORS.gray400}
            />
          </TouchableOpacity>

          {/* Clear Button */}
          <TouchableOpacity
            onPress={handleClear}
            activeOpacity={0.8}
            style={styles.btnClear}
          >
            <Text style={styles.btnClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.gray50,
  },
  scrollView: {
    paddingHorizontal: 16,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.blackOverlay,
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 384,
    alignItems: "center",
    // Shadow for iOS
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    // Elevation for Android
    elevation: 10,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.gray800,
    marginLeft: 8,
  },
  modalImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 16,
  },
  modalText: {
    fontSize: 16,
    color: COLORS.gray600,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 24,
  },
  boldText: {
    fontWeight: "bold",
    color: COLORS.gray800,
  },
  modalButtonContainer: {
    flexDirection: "row",
    width: "100%",
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    backgroundColor: COLORS.gray200,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalButtonCancelText: {
    color: COLORS.gray700,
    fontWeight: "bold",
  },
  modalButtonConfirm: {
    flex: 1,
    backgroundColor: COLORS.blue600,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalButtonConfirmText: {
    color: COLORS.white,
    fontWeight: "bold",
  },
  // Main UI Styles
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: COLORS.gray800,
  },
  exportButton: {
    backgroundColor: COLORS.blue100,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  exportButtonText: {
    color: COLORS.blue700,
    fontWeight: "bold",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  // Dropdown
  dropdownSection: {
    marginBottom: 24,
    zIndex: 50, // Important for dropdown overlapping
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.gray400,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  dropdownButtonInactive: {
    borderColor: COLORS.gray200,
  },
  dropdownButtonActive: {
    borderColor: COLORS.blue500,
    // Simulating ring-1 ring-blue-200 via shadow or slightly different logic if needed
    // Usually border color change is sufficient, but keeping faithful to structure
  },
  dropdownIconContainer: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.blue50,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dropdownLabel: {
    fontSize: 12,
    color: COLORS.gray400,
    fontWeight: "500",
  },
  dropdownValue: {
    color: COLORS.gray800,
    fontWeight: "bold",
    fontSize: 16,
  },
  dropdownMenu: {
    marginTop: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: COLORS.gray200,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 5,
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  dropdownOptionSelected: {
    backgroundColor: "rgba(239, 246, 255, 0.5)", // bg-blue-50/50
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray50,
  },
  optionText: {
    fontSize: 16,
    color: COLORS.gray600,
  },
  optionTextSelected: {
    color: COLORS.blue600,
    fontWeight: "bold",
  },
  // Chart
  chartContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    marginBottom: 24,
    zIndex: -10, // Push behind dropdown
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  chartTitle: {
    color: COLORS.gray800,
    fontWeight: "bold",
  },
  chartStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  // Stats
  statsGrid: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 32,
    zIndex: -10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.gray400,
    fontWeight: "bold",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "900", // font-black
    color: COLORS.gray800,
  },
  statValueBlue: {
    fontSize: 24,
    fontWeight: "900", // font-black
    color: COLORS.blue600,
  },
  statUnit: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  // Control Buttons
  controlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    zIndex: -10,
  },
  btnStart: {
    flex: 1,
    backgroundColor: COLORS.gray900,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  btnStartText: {
    color: COLORS.white,
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  btnPause: {
    width: 64, // w-16
    height: 56, // h-14
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  btnPauseActive: {
    backgroundColor: COLORS.blue600,
  },
  btnPauseInactive: {
    backgroundColor: COLORS.gray200,
    opacity: 0.5,
  },
  btnClear: {
    width: 64,
    height: 56,
    backgroundColor: COLORS.red100,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.red200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  btnClearText: {
    color: COLORS.red600,
    fontWeight: "bold",
    fontSize: 12,
  },
});

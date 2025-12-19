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

export default function AccelerometerScreen() {
  // Added 'clear' to destructuring
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

            // 2. Clear data in Context (Ensure 'clear' exists in your provider)
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
    <View className="flex-1 bg-gray-50">
      {/* --- CUSTOM INSTRUCTION MODAL --- */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showInstructionModal}
        onRequestClose={() => setShowInstructionModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/50 px-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm items-center shadow-lg">
            <View className="flex-row items-center mb-4">
              <Ionicons name="information-circle" size={24} color="#2563EB" />
              <Text className="text-xl font-bold text-gray-800 ml-2">
                Setup Required
              </Text>
            </View>

            <Image
              source={alertImage}
              style={{
                width: 200,
                height: 150,
                borderRadius: 12,
                marginBottom: 16,
              }}
              resizeMode="contain"
            />

            <Text className="text-base text-gray-600 text-center leading-6 mb-6">
              Please ensure your phone is mounted securely in an{" "}
              <Text className="font-bold text-gray-800">
                upright position (Y-axis)
              </Text>
              , using a holder on the dashboard or air vent.
              {"\n\n"}
              This is required for accurate data readings and IRI road condition
              calculations.
            </Text>

            <View className="flex-row w-full gap-3">
              <TouchableOpacity
                onPress={() => setShowInstructionModal(false)}
                className="flex-1 bg-gray-200 py-3 rounded-xl items-center"
              >
                <Text className="text-gray-700 font-bold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmStartSession}
                className="flex-1 bg-blue-600 py-3 rounded-xl items-center"
              >
                <Text className="text-white font-bold">I'm Ready</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView
        className="px-4"
        contentContainerStyle={{
          paddingTop: Platform.OS === "android" ? 50 : 60,
          paddingBottom: 150,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Row */}
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-2xl font-bold text-gray-800">
            Accelerometer
          </Text>
          <TouchableOpacity
            className="bg-blue-100 px-4 py-2 rounded-full"
            onPress={exportLog}
          >
            <Text className="text-blue-700 font-bold text-xs uppercase tracking-wide">
              Export data
            </Text>
          </TouchableOpacity>
        </View>

        {/* --- DROPDOWN SECTION --- */}
        <View className="mb-6 z-50">
          <Text className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 ml-1">
            Session Configuration
          </Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setShowVehicleMenu((prev) => !prev)}
            className={`flex-row items-center bg-white border rounded-xl p-4 shadow-sm ${
              showVehicleMenu
                ? "border-blue-500 ring-1 ring-blue-200"
                : "border-gray-200"
            }`}
          >
            <View className="w-10 h-10 bg-blue-50 rounded-full items-center justify-center mr-3">
              <Ionicons name="car-sport" size={20} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-xs text-gray-400 font-medium">
                Vehicle Used
              </Text>
              <Text className="text-gray-800 font-bold text-base">
                {vehicleType || "Select Your Vehicle Type"}
              </Text>
            </View>
            <Ionicons
              name={showVehicleMenu ? "chevron-up" : "chevron-down"}
              size={20}
              color="#9CA3AF"
            />
          </TouchableOpacity>

          {showVehicleMenu && (
            <View className="mt-2 bg-white border border-gray-100 rounded-xl shadow-lg shadow-gray-200 overflow-hidden">
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
                    className={`flex-row items-center justify-between p-4 ${
                      index !== VEHICLE_OPTIONS.length - 1
                        ? "border-b border-gray-50"
                        : ""
                    } ${isSelected ? "bg-blue-50/50" : ""}`}
                  >
                    <Text
                      className={`text-base ${
                        isSelected ? "text-blue-600 font-bold" : "text-gray-600"
                      }`}
                    >
                      {opt}
                    </Text>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color="#2563EB"
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* --- CHART CONTAINER --- */}
        <View className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 -z-10">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-gray-800 font-bold">
              Vertical Vibration Signal
            </Text>
            <View className="flex-row items-center gap-1">
              <View
                className={`w-2 h-2 rounded-full ${logging ? "bg-green-500" : "bg-gray-300"}`}
              />
              <Text className="text-xs text-gray-400">
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
        <View className="flex-row gap-4 mb-8 -z-10">
          <View className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm items-center">
            <Text className="text-xs text-gray-400 font-bold uppercase mb-1">
              Maximum
            </Text>
            <Text className="text-2xl font-black text-gray-800">
              {maxValue.toFixed(2)}
            </Text>
            <Text className="text-xs text-gray-400">m/s²</Text>
          </View>
          <View className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm items-center">
            <Text className="text-xs text-gray-400 font-bold uppercase mb-1">
              Latest
            </Text>
            <Text className="text-2xl font-black text-blue-600">
              {latestValue.toFixed(2)}
            </Text>
            <Text className="text-xs text-gray-400">m/s²</Text>
          </View>
        </View>

        {/* Controls */}
        <View className="flex-row justify-center items-center gap-3 mb-4 -z-10">
          {/* Start New Session */}
          <TouchableOpacity
            onPress={handleStartPress}
            activeOpacity={0.8}
            className="flex-1 bg-gray-900 py-4 rounded-xl shadow-md active:bg-gray-800"
          >
            <Text className="text-white text-center font-bold text-base">
              New Session
            </Text>
          </TouchableOpacity>

          {/* Pause / Resume */}
          <TouchableOpacity
            disabled={!sessionStarted}
            onPress={logging ? pause : resume}
            activeOpacity={0.8}
            className={`w-16 h-14 rounded-xl items-center justify-center shadow-md ${
              sessionStarted
                ? "bg-blue-600 active:bg-blue-700"
                : "bg-gray-200 opacity-50"
            }`}
          >
            <Ionicons
              name={logging ? "pause" : "play"}
              size={24}
              color={sessionStarted ? "white" : "#9CA3AF"}
            />
          </TouchableOpacity>

          {/* Clear Button */}
          <TouchableOpacity
            onPress={handleClear}
            activeOpacity={0.8}
            className="w-16 h-14 bg-red-100 rounded-xl items-center justify-center shadow-sm active:bg-red-200 border border-red-200"
          >
            <Text className="text-red-600 font-bold text-xs">Clear</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

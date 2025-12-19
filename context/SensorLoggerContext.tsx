// logger for accelerometer sensor

import { db } from "@/firebaseConfig";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// data type
export type LogEntry = {
  x: number;
  y: number;
  z: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  speed: number;
  vehicletype: string;
};

type SensorLoggerContextType = {
  log: LogEntry[];
  logging: boolean;
  startNew: (vehicleType: string) => void;
  pause: () => void;
  resume: () => void;
  clear: () => void;
};

const SensorLoggerContext = createContext<SensorLoggerContextType | null>(null);

// --- HELPER: Manual Distance Calculation (Haversine) ---
function getDistanceFromLatLonInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d * 1000; // Return in meters
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export const SensorLoggerProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logging, setLogging] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const accelerometerSub = useRef<any>(null);
  const locationWatcher = useRef<any>(null);

  // Track previous location to calculate manual speed if GPS fails
  const lastLocationRef = useRef<{
    lat: number;
    lng: number;
    time: number;
  } | null>(null);

  const latestLocation = useRef<{ latitude: number; longitude: number }>({
    latitude: 0,
    longitude: 0,
  });

  const latestSpeed = useRef<number>(0);
  const sampleBuffer = useRef<LogEntry[]>([]);

  // current vehicle type for this session
  const currentVehicleTypeRef = useRef<string>("");

  const uploadBatchToFirestore = async () => {
    if (!sessionId) return;
    if (sampleBuffer.current.length === 0) return;

    try {
      const y_values = sampleBuffer.current.map((s) => s.y);

      await addDoc(collection(db, "vibration_logs", sessionId, "data"), {
        timestamp: Date.now(),
        data: sampleBuffer.current,
        y_values,
        location: {
          latitude: latestLocation.current.latitude,
          longitude: latestLocation.current.longitude,
        },
        speed: latestSpeed.current,
        vehicletype: currentVehicleTypeRef.current,
      });

      console.log(
        `Uploaded batch of ${sampleBuffer.current.length} samples to Firestore`
      );
      sampleBuffer.current = [];
    } catch (err) {
      console.warn("Failed to upload batch:", err);
    }
  };

  useEffect(() => {
    let active = true;

    const setupSensors = async () => {
      if (!logging) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.warn("Location permission not granted");
        return;
      }

      // Location watcher
      locationWatcher.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 500,
          distanceInterval: 0,
        },
        (location) => {
          const { latitude, longitude, speed } = location.coords;
          const timestamp = location.timestamp || Date.now();

          latestLocation.current = { latitude, longitude };

          let currentSpeedKmh = 0;

          if (speed !== null && speed >= 0) {
            currentSpeedKmh = speed * 3.6;
          } else if (lastLocationRef.current) {
            const distMeters = getDistanceFromLatLonInMeters(
              lastLocationRef.current.lat,
              lastLocationRef.current.lng,
              latitude,
              longitude
            );
            const timeDiffSeconds =
              (timestamp - lastLocationRef.current.time) / 1000;

            if (timeDiffSeconds > 0) {
              const speedMs = distMeters / timeDiffSeconds;
              currentSpeedKmh = speedMs * 3.6;
            }
          }

          lastLocationRef.current = {
            lat: latitude,
            lng: longitude,
            time: timestamp,
          };

          const SMOOTHING_FACTOR = 0.8;
          latestSpeed.current =
            latestSpeed.current * (1 - SMOOTHING_FACTOR) +
            currentSpeedKmh * SMOOTHING_FACTOR;
        }
      );

      // Accelerometer
      Accelerometer.setUpdateInterval(10);
      accelerometerSub.current = Accelerometer.addListener((data) => {
        if (!active || !logging) return;

        // Ignore very low speed to avoid idling/ red lights
        if (latestSpeed.current < 5) {
          return;
        }

        const entry: LogEntry = {
          x: data.x,
          y: data.y,
          z: data.z,
          timestamp: Date.now(),
          latitude: latestLocation.current.latitude,
          longitude: latestLocation.current.longitude,
          speed: latestSpeed.current,
          vehicletype: currentVehicleTypeRef.current || "",
        };

        sampleBuffer.current.push(entry);
        setLog((prev) => [...prev, entry]);
      });
    };

    setupSensors();

    let intervalId: any;
    if (logging) {
      intervalId = setInterval(() => {
        uploadBatchToFirestore();
      }, 1000);
    }

    return () => {
      active = false;
      accelerometerSub.current?.remove?.();
      locationWatcher.current?.remove?.();
      clearInterval(intervalId);
    };
  }, [logging]);

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
  };

  const startNew = async (vehicleType: string) => {
    const formattedDate = formatDate(new Date());

    currentVehicleTypeRef.current = vehicleType;

    try {
      await setDoc(doc(db, "vibration_logs", formattedDate), {
        created_at: new Date(),
        session_id: formattedDate,
        status: "active",
        device_speed_check: "enabled",
        vehicletype: vehicleType,
      });
      console.log(`[Session] Parent document created: ${formattedDate}`);
    } catch (err) {
      console.error("[Session] Failed to create parent document:", err);
      return;
    }

    setSessionId(formattedDate);
    setLog([]);
    sampleBuffer.current = [];
    latestSpeed.current = 0;
    lastLocationRef.current = null;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      latestLocation.current = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      latestSpeed.current = loc.coords.speed ? loc.coords.speed * 3.6 : 0;
    }

    setLogging(true);
  };

  const pause = () => {
    setLogging(false);
    sampleBuffer.current = [];
  };

  const resume = () => {
    setLogging(true);
  };

  // --- 2. IMPLEMENTED CLEAR FUNCTION ---
  const clear = () => {
    setLogging(false);
    setLog([]);
    setSessionId(null);
    sampleBuffer.current = [];
    latestSpeed.current = 0;
    lastLocationRef.current = null;
    currentVehicleTypeRef.current = "";

    // Stop sensors immediately
    if (accelerometerSub.current) {
      accelerometerSub.current.remove();
      accelerometerSub.current = null;
    }
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
  };

  return (
    <SensorLoggerContext.Provider
      // --- 3. EXPOSED CLEAR FUNCTION ---
      value={{ log, logging, startNew, pause, resume, clear }}
    >
      {children}
    </SensorLoggerContext.Provider>
  );
};

export const useSensorLogger = (): SensorLoggerContextType => {
  const context = useContext(SensorLoggerContext);
  if (!context) {
    throw new Error(
      "useSensorLogger must be used within a SensorLoggerProvider"
    );
  }
  return context;
};

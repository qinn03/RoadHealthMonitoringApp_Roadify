import {
  Entypo,
  FontAwesome,
  FontAwesome5,
  Ionicons,
} from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

const _layout = () => {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: "#000000",
          height: 50,
          borderWidth: 0,
          position: "absolute",
          paddingTop: 13,
          paddingBottom: 55,
          marginBottom: 45,
          borderRadius: 50,
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <View style={{ alignItems: "center" }}>
              <Ionicons name="home-outline" size={24} color={color} />
              <Text style={{ color, fontSize: 9, fontWeight: 700 }}>Home</Text>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="accelerometer"
        options={{
          title: "Accelerometer",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <View style={{ alignItems: "center", minWidth: 50 }}>
              <FontAwesome name="bar-chart" size={24} color={color} />
              <Text style={{ color, fontSize: 9, fontWeight: 700 }}>
                Sensor
              </Text>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="report"
        options={{
          title: "Report",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <View
              style={{
                width: 70,
                height: 70,
                backgroundColor: "#00a8c6ff",
                borderRadius: 35,
                justifyContent: "center",
                alignItems: "center",
                marginBottom: 30,
                elevation: 4,
              }}
            >
              <Entypo name="warning" size={32} color="#fefe5bfb" />
              <Text
                style={{ fontSize: 9, fontWeight: 700, color: "#ffffffc7" }}
              >
                Report
              </Text>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <View style={{ alignItems: "center" }}>
              <FontAwesome5 name="map-marked-alt" size={20} color={color} />
              <Text style={{ color, fontSize: 9, fontWeight: 700 }}>Map</Text>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <View style={{ alignItems: "center" }}>
              <Ionicons name="person-outline" size={24} color={color} />
              <Text style={{ color, fontSize: 9, fontWeight: 700 }}>
                Profile
              </Text>
            </View>
          ),
        }}
      />
    </Tabs>
  );
};

export default _layout;

import "dotenv/config";

export default {
  expo: {
    name: "Road_App",
    slug: "road-app",
    version: "1.0.0",

    orientation: "portrait",
    userInterfaceStyle: "automatic",
    scheme: "roadapp",

    icon: "./assets/images/icon.png",

    jsEngine: "hermes",
    newArchEnabled: true,

    ios: {
      supportsTablet: true,
    },

    android: {
      package: "com.roadapp",
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
    },

    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/icon.png",
    },

    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      [
        "@rnmapbox/maps",
        {
          RNMapboxMapsImpl: "mapbox",
          RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOADS_TOKEN,
        },
      ],
      "expo-font",
    ],

    experiments: {
      typedRoutes: true,
    },

    extra: {
      MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      eas: {
        projectId: "b3dd1319-d02f-4786-9d31-d5b6f9bede3b",
      },
    },
  },
};

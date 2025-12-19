import "dotenv/config";

export default {
  expo: {
    name: "Road_App",
    slug: "road-app",
    android: {
      package: "com.roadapp",
    },

    plugins: [
      [
        "@rnmapbox/maps",
        {
          RNMapboxMapsImpl: "mapbox",
          RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOADS_TOKEN,
        },
      ],
      ["expo-font"],
    ],

    extra: {
      MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    },
    eas: {
      projectId: "b3dd1319-d02f-4786-9d31-d5b6f9bede3b",
    },
  },
};

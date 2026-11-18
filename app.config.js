/** Tranym-specific app identity; app.json stays aligned with the upstream fork. */
module.exports = ({ config }) => ({
  ...config,
  name: "Tranym",
  slug: "tranym",
  scheme: ["tranym", "zkpassport"],
  android: {
    ...config.android,
    package: "app.mareiski.tranym",
    usesCleartextTraffic: process.env.TRANYM_ALLOW_CLEARTEXT,
  },
})

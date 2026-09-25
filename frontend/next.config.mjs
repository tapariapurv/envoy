/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // `npm run share` passes the LAN IP so teammates' browsers may load the dev bundle.
  allowedDevOrigins: process.env.ENVOY_LAN_HOST ? [process.env.ENVOY_LAN_HOST] : [],
};

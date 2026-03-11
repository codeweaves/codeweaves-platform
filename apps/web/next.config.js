import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  transpilePackages: ['@repo/validation'],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG, // eslint-disable-line no-undef
  project: process.env.SENTRY_PROJECT, // eslint-disable-line no-undef
  authToken: process.env.SENTRY_AUTH_TOKEN, // eslint-disable-line no-undef
  silent: true,
  hideSourceMaps: true,
});

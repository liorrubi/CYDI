// The version identity Play Together sends with create, /info and /ws, so the
// Worker's minimum-version gate (versionGate.ts) can decide BEFORE any RoomDO is
// touched. Only the platform label and the release - the same values every
// analytics event already carries - never the installationId or anything else.

import { Capacitor } from "@capacitor/core";

import { getAnalyticsAppVersion, getAnalyticsAppVersionCode } from "../services/nativeAppInfo";
import { MP_CLIENT_PARAMS } from "./versionGate";

export function multiplayerVersionQuery(): string {
  const params = new URLSearchParams();
  params.set(MP_CLIENT_PARAMS.platform, Capacitor.getPlatform());
  params.set(MP_CLIENT_PARAMS.appVersion, getAnalyticsAppVersion());
  const code = getAnalyticsAppVersionCode();
  if (code !== undefined) params.set(MP_CLIENT_PARAMS.appVersionCode, code);
  return params.toString();
}

import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Alert,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import { WebView, type WebViewMessageEvent } from "react-native-webview"
import type { QRCodeData, ProofResult, QueryResult } from "@zkpassport/utils"
import { useFocusEffect } from "@react-navigation/native"
import { router } from "expo-router"
import { useTranslation } from "react-i18next"
import { useSettings } from "@/context/SettingsContext"
import AccessRequestView from "@/components/AccessRequestView"
import {
  parseTranymProofRequest,
  parseTranymVerificationUrl,
  serializeTranymProofResponse,
  type TranymProofResponse,
} from "@/services/TranymLocalBridge"

const PHOTON_ASSET_URL = "file:///android_asset/photon/start.html"
const IS_STATIC_PHOTON = process.env.EXPO_PUBLIC_PHOTON_MODE === "static"

const PHOTON_URL = IS_STATIC_PHOTON ? PHOTON_ASSET_URL : process.env.EXPO_PUBLIC_PHOTON_URL
const PHOTON_ORIGIN = PHOTON_URL ? new URL(PHOTON_URL).origin : null

function isPhotonUrl(url: string) {
  if (url === "null" && IS_STATIC_PHOTON) return true
  if (!PHOTON_ORIGIN) return false
  try {
    return new URL(url).origin === PHOTON_ORIGIN
  } catch {
    return false
  }
}

export default function TranymPhotonScreen() {
  const webViewRef = useRef<WebView>(null)
  const activeRequestIdRef = useRef<string | null>(null)
  const respondedRef = useRef(false)
  const [credentialsRequest, setCredentialsRequest] = useState<QRCodeData | null>(null)
  const [webViewError, setWebViewError] = useState<string | null>(null)
  const { currentPassport, passports, loadPassports } = useSettings()
  const { t } = useTranslation()

  const postResponse = useCallback((response: TranymProofResponse) => {
    const encoded = serializeTranymProofResponse(response)
    const webView = webViewRef.current
    if (!webView) {
      console.warn("Cannot post Tranym proof response: Photon WebView is unavailable")
      return
    }

    // Proof responses can be several megabytes. Sending the entire JSON value
    // through one injectJavaScript call is unreliable on Android WebView, so
    // assemble it in the page from small, ordered string chunks.
    const chunkSize = 12_000
    const chunkCount = Math.ceil(encoded.length / chunkSize)

    webView.injectJavaScript("window.__tranymProofChunks = []; true;")
    for (let index = 0; index < chunkCount; index += 1) {
      const chunk = encoded.slice(index * chunkSize, (index + 1) * chunkSize)
      webView.injectJavaScript(`window.__tranymProofChunks.push(${JSON.stringify(chunk)}); true;`)
    }
    webView.injectJavaScript(
      `try { const data = JSON.parse(window.__tranymProofChunks.join("")); delete window.__tranymProofChunks; window.dispatchEvent(new MessageEvent("message", { data })); } catch (error) { console.error("Failed to deliver Tranym proof response to Photon", error); } true;`,
    )
  }, [])

  const finishRequest = useCallback(
    (response: TranymProofResponse) => {
      if (respondedRef.current || response.requestId !== activeRequestIdRef.current) return
      respondedRef.current = true
      postResponse(response)
      activeRequestIdRef.current = null
      setCredentialsRequest(null)
    },
    [postResponse],
  )

  const rejectRequest = useCallback(
    (code: "cancelled" | "failed") => {
      const requestId = activeRequestIdRef.current
      if (!requestId) return
      finishRequest({
        type: "passport.proof.error",
        requestId,
        payload: { code },
      })
    },
    [finishRequest],
  )

  useEffect(() => {
    if (!credentialsRequest?.topic) return
    const timeout = setTimeout(() => rejectRequest("failed"), 4 * 60 * 1000)
    return () => clearTimeout(timeout)
  }, [credentialsRequest?.topic, rejectRequest])

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as { type?: string }
        if (message.type === "passport.proof.event") return
      } catch {
        // Continue parsing normal proof requests below.
      }

      if (!isPhotonUrl(event.nativeEvent.url)) return

      if (activeRequestIdRef.current) rejectRequest("cancelled")
      const request = parseTranymProofRequest(event.nativeEvent.data)
      if (!request) return
      const parsedRequest = parseTranymVerificationUrl(request.payload.verificationUrl)

      if (!parsedRequest) {
        activeRequestIdRef.current = request.requestId
        respondedRef.current = false
        rejectRequest("failed")
        return
      }

      activeRequestIdRef.current = request.requestId
      respondedRef.current = false
      const loadedPassports = await loadPassports()
      // Ignore a result if another request replaced this one while storage was loading.
      if (activeRequestIdRef.current !== request.requestId) return
      if (!currentPassport && !Object.values(loadedPassports).some(Boolean)) {
        rejectRequest("failed")
        if (Platform.OS === "android") {
          ToastAndroid.show(t("home.scanIDFirst"), ToastAndroid.LONG)
        } else {
          Alert.alert(t("home.noID"), t("home.scanIDFirst"))
        }
        router.replace("/home")
        return
      }
      setCredentialsRequest(parsedRequest)
    },
    [currentPassport, loadPassports, rejectRequest, t],
  )

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (activeRequestIdRef.current) {
          rejectRequest("cancelled")
        } else {
          // navigate back in webview
          const webView = webViewRef.current
          if (webView) {
            webView.goBack()
            return true
          }
        }
        return true
      })
      return () => subscription.remove()
    }, [rejectRequest]),
  )

  const selectedPassport =
    currentPassport ??
    (credentialsRequest && Object.values(passports).find((passport) => !!passport)) ??
    null

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <WebView
        ref={webViewRef}
        source={{ uri: PHOTON_URL ?? "" }}
        originWhitelist={IS_STATIC_PHOTON ? ["file://*"] : ["file://*", "https://*"]}
        onMessage={onMessage}
        onLoad={() => setWebViewError(null)}
        onError={(event) => setWebViewError(event.nativeEvent.description)}
        onShouldStartLoadWithRequest={(request) => isPhotonUrl(request.url)}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        style={[styles.webView, credentialsRequest && styles.hiddenWebView]}
      />
      {webViewError && !credentialsRequest && (
        <View style={styles.errorPanel}>
          <Text style={styles.errorText}>Photon could not load: {webViewError}</Text>
          <Pressable accessibilityRole="button" onPress={() => webViewRef.current?.reload()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {credentialsRequest && (
        <View style={styles.proofOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to passport manager"
            onPress={() => {
              rejectRequest("cancelled")
              router.replace("/home")
            }}
            style={styles.homeButton}
          >
            <Text style={styles.homeButtonText}>Manage Passports</Text>
          </Pressable>
          <AccessRequestView
            onClose={() => rejectRequest("cancelled")}
            credentialsRequest={credentialsRequest}
            passport={selectedPassport}
            localMode
            onLocalProofComplete={(proofs: ProofResult[], queryResult: QueryResult) => {
              const requestId = activeRequestIdRef.current
              if (!requestId) return
              finishRequest({
                type: "passport.proof.result",
                requestId,
                payload: { proofs, queryResult },
              })
            }}
            onLocalError={() => rejectRequest("failed")}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  webView: { flex: 1 },
  backButton: {
    position: "absolute",
    top: 8,
    left: 12,
    zIndex: 2,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.96)",
    elevation: 4,
  },
  backButtonText: { color: "#07245C", fontWeight: "700" },
  homeButton: {
    position: "absolute",
    top: 28,
    left: 12,
    zIndex: 2,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.96)",
    elevation: 4,
  },
  homeButtonText: { color: "#07245C", fontWeight: "700" },
  errorPanel: {
    position: "absolute",
    top: "40%",
    left: 24,
    right: 24,
    alignItems: "center",
    borderRadius: 16,
    padding: 20,
    backgroundColor: "white",
    elevation: 6,
  },
  errorText: { color: "#991B1B", textAlign: "center" },
  retryText: { color: "#07245C", fontWeight: "700", padding: 12 },
  hiddenWebView: { opacity: 0 },
  proofOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
    backgroundColor: "#07245C",
  },
})

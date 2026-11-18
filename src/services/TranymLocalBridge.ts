import * as Linking from "expo-linking"
import type { QRCodeData, Query, Service } from "@zkpassport/utils"
import { NullifierType } from "@zkpassport/utils"

/** Wire contract for requests from Photon in the bundled Tranym Android WebView. */
export type TranymProofRequest = {
  type: "passport.proof.request"
  requestId: string
  payload: { verificationUrl: string }
}

export type TranymProofResponse = {
  type: "passport.proof.result" | "passport.proof.error"
  requestId: string
  payload:
    | { proofs: unknown[]; queryResult: unknown }
    | { code: "cancelled" | "invalid_request" | "failed" | "timeout" }
}

const MAX_MESSAGE_LENGTH = 32_768
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Parse and validate the JSON received through React Native WebView.onMessage. */
export function parseTranymProofRequest(raw: string): TranymProofRequest | undefined {
  if (raw.length === 0 || raw.length > MAX_MESSAGE_LENGTH) return undefined

  try {
    const message = JSON.parse(raw) as Partial<TranymProofRequest>
    if (
      message.type !== "passport.proof.request" ||
      typeof message.requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(message.requestId) ||
      !message.payload ||
      typeof message.payload.verificationUrl !== "string" ||
      message.payload.verificationUrl.length > 24_000
    )
      return undefined

    const url = new URL(message.payload.verificationUrl)
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "zkpassport.id" || url.hostname.endsWith(".zkpassport.id")) ||
      !(url.pathname === "/r" || url.pathname.startsWith("/r/"))
    )
      return undefined

    return message as TranymProofRequest
  } catch {
    return undefined
  }
}

export function serializeTranymProofResponse(response: TranymProofResponse): string {
  return JSON.stringify(response)
}
/** Convert the SDK request URL into the same request model used by QR/deep-link flows. */
export function parseTranymVerificationUrl(url: string): QRCodeData | undefined {
  try {
    const { queryParams } = Linking.parse(url)
    const queryBase64 = queryParams?.c
    const serviceBase64 = queryParams?.s
    if (typeof queryBase64 !== "string" || typeof serviceBase64 !== "string") return undefined

    const query = JSON.parse(atob(queryBase64)) as Query
    const service = JSON.parse(atob(serviceBase64)) as Service
    const topic = queryParams?.t
    const pubkey = queryParams?.p
    const domain = queryParams?.d
    if (
      typeof topic !== "string" ||
      typeof pubkey !== "string" ||
      typeof domain !== "string" ||
      !topic ||
      !pubkey ||
      !domain
    )
      return undefined

    const mode = queryParams?.m === "compressed" ? "compressed" : "fast"
    const timestamp = queryParams?.dt
    const nullifierType = queryParams?.nt
    return {
      query,
      topic,
      pubkey,
      domain,
      service,
      mode,
      sdkVersion: typeof queryParams?.v === "string" ? queryParams.v : null,
      timestamp: typeof timestamp === "string" ? Number(timestamp) : null,
      devMode: queryParams?.dev === "1",
      uniqueIdentifierType:
        typeof nullifierType === "string" ? (Number(nullifierType) as NullifierType) : null,
      oprfKeyId: typeof queryParams?.oprf_k === "string" ? queryParams.oprf_k : null,
      returnDeepLink: typeof queryParams?.r === "string" ? queryParams.r : null,
    }
  } catch {
    return undefined
  }
}

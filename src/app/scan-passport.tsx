import { useLocalSearchParams, useRouter } from "expo-router"
import ScanPassportView from "@/components/ScanPassportView"

export default function ScanPassportRoute() {
  const router = useRouter()
  const { initialStep } = useLocalSearchParams<{ initialStep?: string }>()

  const handleFinish = () => {
    router.replace("/home")
  }

  const handleCancel = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace("/home")
    }
  }

  return (
    <ScanPassportView
      initialStep={(initialStep as any) || "CHOOSE_ID_TYPE"}
      onFinish={handleFinish}
      onCancel={handleCancel}
    />
  )
}

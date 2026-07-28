import { useEffect } from "react"
import { useSong } from "../../hooks/useSong"
import { useLocalization } from "../../localize/useLocalization"

export const OnBeforeUnload = () => {
  const { getSong } = useSong()
  const localized = useLocalization()

  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (!getSong().isSaved) {
        const message = localized["confirm-close"]
        e.returnValue = message
      }
    }
    window.addEventListener("beforeunload", listener)

    return () => {
      window.removeEventListener("beforeunload", listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <></>
}

"use client"

import { useEffect, useRef, useCallback } from "react"

/**
 * Synthesizes a WhatsApp-style "ding" notification sound using the
 * Web Audio API — no audio file required.
 */
function playNotificationSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()

    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    // Two-tone "ding-dong" similar to WhatsApp notification
    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(880, ctx.currentTime)
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.12)

    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01)
    gain.gain.setValueAtTime(0.35, ctx.currentTime + 0.11)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.55)

    // Close context when done to free resources
    oscillator.onended = () => void ctx.close()
  } catch {
    // Audio API unavailable or blocked — silently ignore
  }
}

export function useMessageNotifications() {
  const permissionRef = useRef<NotificationPermission>("default")

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return

    permissionRef.current = Notification.permission

    // Request permission proactively so the first notification isn't blocked
    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        permissionRef.current = perm
      })
    }
  }, [])

  /**
   * Fire a sound + optional browser notification for an inbound message.
   *
   * @param senderName  Contact's display name (shown as notification title)
   * @param messageText Message preview text (shown as notification body)
   * @param silent      When true, skip sound (e.g. user is actively viewing the thread)
   */
  const notify = useCallback(
    (senderName: string, messageText: string, silent = false) => {
      if (!silent) {
        playNotificationSound()
      }

      // Show a browser notification when the tab is not focused
      if (
        typeof document !== "undefined" &&
        !document.hasFocus() &&
        "Notification" in window &&
        permissionRef.current === "granted"
      ) {
        try {
          const notification = new Notification(senderName, {
            body: messageText,
            // Use the app favicon as icon if it exists; browsers silently
            // ignore a missing icon so no error handling is needed
            icon: "/favicon.ico",
            tag: `msg-${Date.now()}`,
            // We handle sound ourselves above
            silent: true,
          })

          notification.onclick = () => {
            window.focus()
            notification.close()
          }

          // Auto-dismiss after 6 seconds
          setTimeout(() => notification.close(), 6000)
        } catch {
          // Notification API blocked or unavailable
        }
      }
    },
    []
  )

  return { notify }
}

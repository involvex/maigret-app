package com.maigret.foreground

import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge for scan keep-alive (foreground service) and proxied fetching.
 * All functions are safe to call from Expo Go: the JS wrapper guards with
 * `requireOptionalNativeModule`, so they only run in development/production
 * builds where this module is linked.
 */
class MaigretForegroundModule : Module() {

  private fun serviceContext(): Context =
    appContext.reactContext
      ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("MaigretForeground")

    AsyncFunction("startService") { title: String, body: String ->
      val context = serviceContext()
      val intent = MaigretScanService.intent(context, title, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        @Suppress("DEPRECATION")
        context.startService(intent)
      }
      true
    }

    AsyncFunction("updateService") { title: String, body: String ->
      // Re-delivery rebuilds the notification in place.
      val context = serviceContext()
      val intent = MaigretScanService.intent(context, title, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        @Suppress("DEPRECATION")
        context.startService(intent)
      }
      true
    }

    AsyncFunction("stopService") { ->
      val context = serviceContext()
      context.stopService(MaigretScanService.intent(context, "", ""))
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(MaigretScanService.NOTIFICATION_ID)
      true
    }

    AsyncFunction("setProxy") { url: String ->
      val uri = try {
        Uri.parse(if (url.contains("://")) url else "socks5://$url")
      } catch (e: Exception) {
        throw IllegalArgumentException("Invalid proxy URL: ${e.message}")
      }
      val scheme = (uri.scheme ?: "socks5").lowercase()
      val host = uri.host?.takeIf { it.isNotEmpty() }
        ?: throw IllegalArgumentException("Proxy URL is missing a host")
      val port = if (uri.port != -1) uri.port else defaultPort(scheme)
      if (port <= 0 || port > 65535) {
        throw IllegalArgumentException("Proxy port is out of range (1-65535)")
      }
      val username = uri.userInfo?.substringBefore(":")?.takeIf { it.isNotEmpty() }
      val password = uri.userInfo?.substringAfter(":", "")?.takeIf { it.isNotEmpty() }
      ProxyStore.set(scheme, host, port, username, password)
      true
    }

    AsyncFunction("clearProxy") { ->
      ProxyStore.clear()
      true
    }

    AsyncFunction("fetchUrl") { options: Map<String, Any> ->
      val url = options["url"] as? String
        ?: throw IllegalArgumentException("fetchUrl requires a 'url' string")
      val method = (options["method"] as? String) ?: "GET"
      @Suppress("UNCHECKED_CAST")
      val headers = (options["headers"] as? Map<String, String>) ?: emptyMap()
      val timeoutMs = (options["timeoutMs"] as? Number)?.toInt() ?: 15000
      val withDefaults = DEFAULT_HEADERS + headers
      ProxyStore.fetch(url, method, withDefaults, timeoutMs)
    }
  }

  companion object {
    private val DEFAULT_HEADERS = mapOf(
      "User-Agent" to "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
      "Accept" to "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language" to "en-US,en;q=0.9",
    )

    private fun defaultPort(scheme: String): Int = when (scheme) {
      "http", "https" -> 8080
      else -> 1080
    }
  }
}

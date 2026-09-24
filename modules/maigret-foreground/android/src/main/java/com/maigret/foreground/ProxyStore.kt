package com.maigret.foreground

import java.net.InetSocketAddress
import java.net.Proxy
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import okhttp3.Credentials
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * OkHttp client holder with an optional proxy (HTTP/SOCKS + auth).
 * React Native's `fetch` cannot route SOCKS5/Tor traffic, so the engine
 * calls [fetch] for proxied scans. Rebuilding the client on every proxy
 * change keeps the setting always effective (no global RN client hacks).
 */
object ProxyStore {
  private const val MAX_BODY_BYTES = 1_500_000

  @Volatile
  private var proxy: Proxy? = null

  @Volatile
  private var auth: Pair<String, String>? = null

  @Synchronized
  fun set(scheme: String, host: String, port: Int, username: String?, password: String?) {
    val type = when (scheme.lowercase()) {
      "http", "https" -> Proxy.Type.HTTP
      "socks5", "socks5h" -> Proxy.Type.SOCKS
      else -> throw IllegalArgumentException("Unsupported proxy scheme: $scheme")
    }
    proxy = Proxy(type, InetSocketAddress(host, port))
    auth = if (!username.isNullOrEmpty()) Pair(username, password.orEmpty()) else null
  }

  @Synchronized
  fun clear() {
    proxy = null
    auth = null
  }

  fun hasProxy(): Boolean = proxy != null

  private fun client(timeoutMs: Int): OkHttpClient {
    val builder = OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .writeTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .followRedirects(true)
      .followSslRedirects(true)
    val currentProxy = proxy
    if (currentProxy != null) {
      builder.proxy(currentProxy)
      val currentAuth = auth
      if (currentAuth != null) {
        val (user, pass) = currentAuth
        builder.proxyAuthenticator { _, response ->
          response.request.newBuilder()
            .header("Proxy-Authorization", Credentials.basic(user, pass))
            .build()
        }
      }
    }
    return builder.build()
  }

  /**
   * Executes one request. Never throws: transport failures are reported via
   * the `error` field (`timeout` | `network`) so the engine can classify
   * them like any other Maigret check error.
   */
  fun fetch(
    url: String,
    method: String,
    headers: Map<String, String>,
    timeoutMs: Int,
  ): Map<String, Any?> {
    val normalizedMethod = method.uppercase()
    return try {
      val builder = Request.Builder().url(url)
      for ((name, value) in headers) {
        builder.header(name, value)
      }
      if (normalizedMethod == "HEAD") {
        builder.head()
      } else if (normalizedMethod == "GET") {
        builder.get()
      } else {
        builder.method(normalizedMethod, ByteArray(0).toRequestBody(null))
      }
      client(timeoutMs).newCall(builder.build()).execute().use { response ->
        val finalUrl = response.request.url.toString()
        val body = if (normalizedMethod == "HEAD") {
          ""
        } else {
          val bytes = response.body?.bytes() ?: ByteArray(0)
          val capped = if (bytes.size > MAX_BODY_BYTES) bytes.copyOf(MAX_BODY_BYTES) else bytes
          String(capped, Charsets.UTF_8)
        }
        mapOf(
          "status" to response.code,
          "url" to finalUrl,
          "body" to body,
          "error" to null,
        )
      }
    } catch (e: SocketTimeoutException) {
      mapOf("status" to 0, "url" to url, "body" to "", "error" to "timeout")
    } catch (e: Exception) {
      val interrupted = e is InterruptedException ||
        (e.cause is InterruptedException) ||
        e.message?.contains("canceled", ignoreCase = true) == true
      mapOf(
        "status" to 0,
        "url" to url,
        "body" to "",
        "error" to if (interrupted) "timeout" else "network",
      )
    }
  }
}

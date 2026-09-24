package com.maigret.foreground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service (type `dataSync`) that keeps Maigret scans alive while
 * the screen is locked. Started with the current scan title/body and updated
 * in place via repeated startService calls.
 */
class MaigretScanService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val body = intent?.getStringExtra(EXTRA_BODY) ?: DEFAULT_BODY
    val notification = buildNotification(title, body)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      @Suppress("DEPRECATION")
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    @Suppress("DEPRECATION")
    stopForeground(true)
    super.onDestroy()
  }

  private fun buildNotification(title: String, body: String): Notification {
    ensureChannel()
    val smallIcon = applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.stat_sys_download
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(smallIcon)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(smallIcon)
        .setOngoing(true)
        .build()
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Maigret scans",
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }
  }

  companion object {
    const val NOTIFICATION_ID = 0x4d414947 // "MAIG"
    const val CHANNEL_ID = "maigret_scan"
    const val EXTRA_TITLE = "com.maigret.foreground.EXTRA_TITLE"
    const val EXTRA_BODY = "com.maigret.foreground.EXTRA_BODY"
    const val DEFAULT_TITLE = "Maigret scan running"
    const val DEFAULT_BODY = "Checking sites…"

    fun intent(context: Context, title: String, body: String): Intent =
      Intent(context, MaigretScanService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
  }
}

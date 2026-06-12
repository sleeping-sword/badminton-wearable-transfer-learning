package com.example.garminreceiver

import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import com.garmin.android.connectiq.ConnectIQ
import com.garmin.android.connectiq.IQApp
import com.garmin.android.connectiq.IQDevice
import com.garmin.android.connectiq.exception.InvalidStateException
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {

    private lateinit var connectIQ: ConnectIQ
    private lateinit var statusText: TextView
    private lateinit var fileListLayout: LinearLayout

    private val watchAppId = "761ceca7-5908-44bd-87ff-beac971dda5c"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── 根佈局 ──────────────────────────────────────────
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 60, 32, 32)
            setBackgroundColor(0xFFF5F5F5.toInt())
        }
        setContentView(root)

        // ── 標題 ────────────────────────────────────────────
        root.addView(TextView(this).apply {
            text = "🏸 羽球智能教練"
            textSize = 22f
            setTextColor(0xFF1A237E.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 24)
        })

        // ── 狀態卡片 ────────────────────────────────────────
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFFFFFF.toInt())
            setPadding(28, 28, 28, 28)
            elevation = 6f
        }
        root.addView(card, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = 24 })

        statusText = TextView(this).apply {
            text = "⏳ 初始化中..."
            textSize = 15f
            setTextColor(0xFF333333.toInt())
            setLineSpacing(0f, 1.4f)
        }
        card.addView(statusText)

        // ── 查看檔案按鈕 ─────────────────────────────────────
        val btnView = Button(this).apply {
            text = "📂 查看已儲存的 JSON 檔案"
            textSize = 15f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF1565C0.toInt())
            setPadding(0, 20, 0, 20)
            setOnClickListener { refreshFileList() }
        }
        root.addView(btnView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = 16 })

        // ── 檔案清單區（可捲動）──────────────────────────────
        val scroll = ScrollView(this)
        fileListLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(fileListLayout)
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        // ── 初始化 SDK ───────────────────────────────────────
        connectIQ = ConnectIQ.getInstance(this, ConnectIQ.IQConnectType.WIRELESS)
        connectIQ.initialize(this, true, object : ConnectIQ.ConnectIQListener {
            override fun onInitializeError(errStatus: ConnectIQ.IQSdkErrorStatus?) {
                runOnUiThread { statusText.text = "❌ SDK 初始化失敗：$errStatus" }
            }
            override fun onSdkReady() {
                runOnUiThread { statusText.text = "✅ SDK 就緒，尋找裝置..." }
                findDeviceAndRegister()
            }
            override fun onSdkShutDown() {
                runOnUiThread { statusText.text = "⚠️ SDK 已關閉" }
            }
        })

        refreshFileList()
    }

    private fun findDeviceAndRegister() {
        try {
            val devices = connectIQ.knownDevices
            if (devices.isNullOrEmpty()) {
                runOnUiThread { statusText.text = "❌ 找不到裝置\n請確認 Garmin Connect 已開啟並與手錶連線" }
                return
            }
            val device = devices[0]
            val app = IQApp(watchAppId)

            connectIQ.registerForAppEvents(device, app) { iqDevice: IQDevice, iqApp: IQApp, message: List<Any>?, status ->
                runOnUiThread {
                    try {
                        if (message != null) handleMessage(iqDevice.friendlyName, message)
                    } catch (e: Exception) {
                        statusText.text = "❌ 處理訊息失敗：${e.message}"
                    }
                }
            }
            runOnUiThread {
                statusText.text = "📡 已連線：${device.friendlyName}\n等待手錶傳送資料..."
            }
        } catch (e: InvalidStateException) {
            runOnUiThread { statusText.text = "❌ 無效狀態：${e.message}" }
        } catch (e: Exception) {
            runOnUiThread { statusText.text = "❌ 錯誤：${e.message}" }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun handleMessage(deviceName: String, message: List<Any>) {
        val data = message.firstOrNull() as? Map<*, *> ?: run {
            statusText.text = "⚠️ 格式不符：$message"
            return
        }
        val type = data["type"] as? String ?: return

        when (type) {
            "alldata" -> {
                val sampleRate = (data["sampleRate"] as? Number)?.toInt() ?: 25
                val duration   = (data["duration"]   as? Number)?.toDouble() ?: 0.0
                val accX  = data["accX"].toIntList()
                val accY  = data["accY"].toIntList()
                val accZ  = data["accZ"].toIntList()
                val gyroX = data["gyroX"].toIntList()
                val gyroY = data["gyroY"].toIntList()
                val gyroZ = data["gyroZ"].toIntList()
                val n = accX.size
                statusText.text = "⏳ 收到 $n 筆資料，儲存中..."
                val path = saveJson(sampleRate, duration, accX, accY, accZ, gyroX, gyroY, gyroZ)
                val fileName = path.substringAfterLast("/")
                statusText.text = "✅ 已儲存 $n 筆\n📁 $fileName"
                refreshFileList()
            }
            else -> statusText.text = "📨 收到未知訊息 type=$type"
        }
    }

    private fun refreshFileList() {
        fileListLayout.removeAllViews()
        val files = filesDir.listFiles { f -> f.name.endsWith(".json") }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()

        if (files.isEmpty()) {
            fileListLayout.addView(TextView(this).apply {
                text = "（尚無儲存的檔案）"
                textSize = 13f
                setTextColor(0xFF888888.toInt())
                setPadding(8, 16, 8, 0)
            })
            return
        }

        val fmt = SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.getDefault())
        files.forEach { f ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(0xFFFFFFFF.toInt())
                setPadding(24, 20, 24, 20)
                elevation = 3f
            }
            row.addView(TextView(this).apply {
                text = "📄 ${f.name}"
                textSize = 14f
                setTextColor(0xFF1565C0.toInt())
            })
            row.addView(TextView(this).apply {
                text = "大小：${"%.1f".format(f.length() / 1024.0)} KB　時間：${fmt.format(Date(f.lastModified()))}"
                textSize = 12f
                setTextColor(0xFF666666.toInt())
                setPadding(0, 4, 0, 4)
            })
            row.addView(TextView(this).apply {
                text = f.absolutePath
                textSize = 11f
                setTextColor(0xFF999999.toInt())
            })
            // 按鈕列
            val btnRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 8, 0, 0)
            }
            // 分享按鈕
            btnRow.addView(Button(this).apply {
                text = "📤 分享"
                textSize = 13f
                setTextColor(0xFFFFFFFF.toInt())
                setBackgroundColor(0xFF43A047.toInt())
                setPadding(0, 12, 0, 12)
                setOnClickListener {
                    val uri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        f
                    )
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(intent, "分享 ${f.name}"))
                }
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            // 刪除按鈕
            btnRow.addView(Button(this).apply {
                text = "🗑️ 刪除"
                textSize = 13f
                setTextColor(0xFFFFFFFF.toInt())
                setBackgroundColor(0xFFE53935.toInt())
                setPadding(0, 12, 0, 12)
                setOnClickListener {
                    android.app.AlertDialog.Builder(this@MainActivity)
                        .setTitle("確認刪除")
                        .setMessage("刪除 ${f.name}？")
                        .setPositiveButton("刪除") { _, _ ->
                            f.delete()
                            refreshFileList()
                        }
                        .setNegativeButton("取消", null)
                        .show()
                }
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(btnRow)
            fileListLayout.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 12 })
        }
    }

    private fun saveJson(
        sampleRate: Int, duration: Double,
        accX: List<Int>, accY: List<Int>, accZ: List<Int>,
        gyroX: List<Int>, gyroY: List<Int>, gyroZ: List<Int>
    ): String {
        val time = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val file = File(filesDir, "garmin_$time.json")
        val interval = if (sampleRate > 0) 1000.0 / sampleRate else 40.0
        val n = accX.size
        val sb = StringBuilder()
        sb.append("{\n  \"recorded_at\": \"$time\",\n  \"duration_sec\": $duration,\n")
        sb.append("  \"sample_rate_hz\": $sampleRate,\n  \"sample_count\": $n,\n")
        sb.append("  \"columns\": [\"time_ms\",\"accX\",\"accY\",\"accZ\",\"gyroX\",\"gyroY\",\"gyroZ\"],\n")
        sb.append("  \"samples\": [\n")
        for (i in 0 until n) {
            val t = (i * interval).toLong()
            sb.append("    [$t,${accX[i]},${accY[i]},${accZ[i]},${gyroX.getOrElse(i){0}},${gyroY.getOrElse(i){0}},${gyroZ.getOrElse(i){0}}]")
            if (i < n - 1) sb.append(",")
            sb.append("\n")
        }
        sb.append("  ]\n}\n")
        val content = sb.toString()
        file.writeText(content)

        // 同時複製一份到 Downloads（USB 連電腦可見）
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, "garmin_$time.json")
                    put(MediaStore.Downloads.MIME_TYPE, "application/json")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                uri?.let {
                    contentResolver.openOutputStream(it)?.use { os -> os.write(content.toByteArray()) }
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    contentResolver.update(it, values, null, null)
                }
            } else {
                val dl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                File(dl, "garmin_$time.json").writeText(content)
            }
        } catch (e: Exception) { /* 下載資料夾寫入失敗不影響主流程 */ }

        return file.absolutePath
    }

    private fun Any?.toIntList(): List<Int> =
        (this as? List<*>)?.mapNotNull { (it as? Number)?.toInt() } ?: emptyList()

    override fun onDestroy() {
        super.onDestroy()
        try { connectIQ.shutdown(this) } catch (e: Exception) {}
    }
}
package com.aura.automotive

import android.Manifest
import android.content.pm.PackageManager
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

/** AURA Automotive WebView container entry point. */
class BaselineActivity : Activity() {
    private var webView: WebView? = null
    private var pendingMediaRequest: PermissionRequest? = null
    private var pendingLocation: Pair<String, GeolocationPermissions.Callback>? = null
    private val locationPermissionCode = 503
    private val mediaPermissionCode = 501
    private val fileChooserCode = 502
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val isDebug = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

        if (!isDebug) {
            // Release mode limitation
            setContentView(TextView(this).apply {
                text = "Development container is unavailable in release mode."
                setTextColor(Color.WHITE)
                textSize = 24f
            })
            return
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = true // Explicit user-selected content URIs; external navigation remains blocked.
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportMultipleWindows(false)
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                    val origin = Uri.parse(view?.url ?: "")
                    if (origin.scheme != "http" || origin.host != "127.0.0.1" || origin.port != 5173 || callback == null || params == null) return false
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = callback
                    return try {
                        startActivityForResult(params.createIntent().apply { addCategory(Intent.CATEGORY_OPENABLE) }, fileChooserCode)
                        true
                    } catch (_: Exception) {
                        pendingFileCallback?.onReceiveValue(null)
                        pendingFileCallback = null
                        false
                    }
                }
                override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                    if (origin == null || callback == null) return
                    val uri = Uri.parse(origin)
                    if (uri.scheme != "http" || uri.host != "127.0.0.1" || uri.port != 5173 || pendingLocation != null || pendingMediaRequest != null) {
                        callback.invoke(origin, false, false)
                        return
                    }
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) callback.invoke(origin, true, false)
                    else {
                        pendingLocation = Pair(origin, callback)
                        requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), locationPermissionCode)
                    }
                }
                override fun onGeolocationPermissionsHidePrompt() {
                    pendingLocation?.let { it.second.invoke(it.first, false, false) }
                    pendingLocation = null
                }
                override fun onPermissionRequest(request: PermissionRequest?) {
                    if (request == null) return
                    val origin = request.origin
                    val allowed = setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE, PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    if (origin.scheme != "http" || origin.host != "127.0.0.1" || origin.port != 5173 ||
                        request.resources.any { it !in allowed } || pendingMediaRequest != null || pendingLocation != null) {
                        request.deny()
                        return
                    }
                    val required = request.resources.map {
                        if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA
                    }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                    if (required.isEmpty()) request.grant(request.resources)
                    else {
                        pendingMediaRequest = request
                        requestPermissions(required.toTypedArray(), mediaPermissionCode)
                    }
                }
                override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                    if (pendingMediaRequest === request) pendingMediaRequest = null
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: ""
                    // Only allow loopback origin for debug loading
                    if (url.startsWith("http://127.0.0.1:5173/")) {
                        return false // Allow WebView to load this URL
                    }
                    // Prevent external navigation and mixed content
                    return true
                }
            }

            val demoQuery = if (intent.getStringExtra("demo") == "pact") "?demo=pact" else ""
            loadUrl("http://127.0.0.1:5173/$demoQuery")
        }

        setContentView(webView)
    }

    @Deprecated("Android Activity result callback retained for this minimal container")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != fileChooserCode) return
        pendingFileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        pendingFileCallback = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == locationPermissionCode) {
            val request = pendingLocation ?: return
            pendingLocation = null
            val granted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            request.second.invoke(request.first, granted && !isFinishing && !isDestroyed, false)
            return
        }
        if (requestCode != mediaPermissionCode) return
        val request = pendingMediaRequest ?: return
        pendingMediaRequest = null
        val allGranted = request.resources.all {
            val permission = if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO else Manifest.permission.CAMERA
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        }
        if (allGranted && !isFinishing && !isDestroyed) request.grant(request.resources) else request.deny()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.evaluateJavascript("document.dispatchEvent(new Event('aura:media-stop'))", null)
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        pendingLocation?.let { it.second.invoke(it.first, false, false) }
        pendingLocation = null
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        pendingMediaRequest?.deny()
        pendingMediaRequest = null
        webView?.stopLoading()
        (webView?.parent as? ViewGroup)?.removeView(webView)
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

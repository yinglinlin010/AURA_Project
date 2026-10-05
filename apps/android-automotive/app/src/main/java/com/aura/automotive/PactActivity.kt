package com.aura.automotive

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

/** Packaged offline PACT simulator. Does not expose native vehicle APIs. */
class PactActivity : Activity() {
    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(20, 20, 21))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportMultipleWindows(false)
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) { request?.deny() }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    return uri.scheme != "https" || uri.host != "appassets.androidplatform.net" ||
                        uri.path?.startsWith("/assets/pact/") != true
                }
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse {
                    val uri = request?.url
                    if (uri != null && uri.scheme == "https" && uri.host == "appassets.androidplatform.net" &&
                        uri.path?.startsWith("/assets/pact/") == true) {
                        loader.shouldInterceptRequest(uri)?.let { return it }
                    }
                    // No network fallback for missing or external resources.
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/pact/pact.html")
        }
        setContentView(webView)
    }
    override fun onResume() { super.onResume(); webView?.onResume() }
    override fun onPause() { webView?.onPause(); super.onPause() }
    override fun onDestroy() {
        webView?.stopLoading()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

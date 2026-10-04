package com.aura.automotive

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/** Empty launch target required to package and start this Android application. */
class BaselineActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply { text = "AURA Automotive — empty baseline placeholder" })
    }
}

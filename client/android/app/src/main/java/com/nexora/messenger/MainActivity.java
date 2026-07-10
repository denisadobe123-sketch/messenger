package com.nexora.messenger;

import android.Manifest;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Запрашиваем разрешения на камеру/микрофон на уровне Android —
        // без этого браузерный getUserMedia() для звонков не сработает.
        String[] permissions = {
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        };
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, permissions, 1001);
        }

        // ВАЖНО: используем родной BridgeWebChromeClient Capacitor, а не голый
        // WebChromeClient. Голый WebChromeClient (как было раньше) не реализует
        // onShowFileChooser() — из-за этого <input type="file"> НИГДЕ в приложении
        // не открывал системный пикер файлов (ни аватар, ни история, ни вложения
        // в чате). BridgeWebChromeClient уже правильно обрабатывает и это, и запрос
        // разрешений камеры/микрофона для getUserMedia (нужно для звонков).
        this.getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(this.getBridge()));
    }
}

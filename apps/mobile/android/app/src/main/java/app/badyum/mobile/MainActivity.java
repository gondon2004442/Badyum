package app.badyum.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрация обязана случиться до super.onCreate: мост собирает список
        // плагинов при создании и позже о новых не узнаёт.
        registerPlugin(VoicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
